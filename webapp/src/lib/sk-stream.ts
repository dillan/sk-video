/**
 * The Signal K delta-stream client: ONE same-origin WebSocket to `/signalk/v1/stream` carries live
 * vessel state (position/heading/SOG) and the plugin's `notifications.sk-video.*` subtree for every
 * screen — the JAUTHENTICATION cookie rides the handshake, so there is no token plumbing. Reconnects
 * with jittered exponential backoff and treats a long-silent socket as dead (stall detect). A client
 * MUST reseed REST state (GET /mob) in `onConnect` before trusting deltas — a reconnect can otherwise
 * silently under-report an active MOB.
 */

import type { IVesselState } from './format';
import { radToDeg, mpsToKnots } from './format';

export interface IDeltaValue {
  path: string;
  value: unknown;
}

/** Parse one raw websocket frame into delta values; tolerates hello frames and junk. */
export function parseDeltaValues(raw: unknown): IDeltaValue[] {
  let msg: unknown = raw;
  if (typeof raw === 'string') {
    try {
      msg = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const updates = (msg as { updates?: unknown })?.updates;
  if (!Array.isArray(updates)) {
    return [];
  }
  const out: IDeltaValue[] = [];
  for (const u of updates) {
    const values = (u as { values?: unknown })?.values;
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      const path = (v as { path?: unknown })?.path;
      if (typeof path === 'string') {
        out.push({ path, value: (v as { value?: unknown }).value });
      }
    }
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strip a server-appended notification id: `notifications.sk-video.mob.<uuid>` → `…mob`. */
export function stripNotificationId(path: string): string {
  const segments = path.split('.');
  return segments.length > 1 && UUID_RE.test(segments[segments.length - 1])
    ? segments.slice(0, -1).join('.')
    : path;
}

/**
 * The plugin-notification key for a delta path, or null for foreign subtrees. Two families map:
 * plugin-scoped keys under `notifications.sk-video.` (mob, incident, anchor) and camera-path
 * alarms under `notifications.cameras.` — whose key is the path minus `notifications.`, matching
 * the bridge's key for the same alarm so the shared ack round-trip works.
 */
export function notificationKey(path: string): string | null {
  const normalized = stripNotificationId(path);
  const pluginPrefix = 'notifications.sk-video.';
  if (normalized.startsWith(pluginPrefix)) {
    return normalized.slice(pluginPrefix.length);
  }
  if (normalized.startsWith('notifications.cameras.')) {
    return normalized.slice('notifications.'.length);
  }
  return null;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Fold one navigation delta into the vessel state; unrelated paths return `prev` unchanged. */
export function applyVesselDelta(prev: IVesselState, delta: IDeltaValue): IVesselState {
  switch (delta.path) {
    case 'navigation.position': {
      const pos = delta.value as { latitude?: unknown; longitude?: unknown } | null;
      const lat = num(pos?.latitude);
      const lon = num(pos?.longitude);
      return { ...prev, hasFix: lat !== undefined && lon !== undefined, lat, lon };
    }
    case 'navigation.headingTrue':
    case 'navigation.headingMagnetic': {
      const rad = num(delta.value);
      // True heading wins; magnetic only fills in when nothing better has arrived.
      if (delta.path === 'navigation.headingMagnetic' && prev.headingDeg !== undefined) {
        return prev;
      }
      return rad === undefined ? prev : { ...prev, headingDeg: radToDeg(rad) };
    }
    case 'navigation.speedOverGround': {
      const mps = num(delta.value);
      return mps === undefined ? prev : { ...prev, sogKn: mpsToKnots(mps) };
    }
    default:
      return prev;
  }
}

/** One active plugin notification, as the shell tracks it. */
export interface IAlert {
  key: string;
  state: string;
  message: string;
  /** Silenced = acknowledged shared-state (method emptied or status.acknowledged). */
  silenced: boolean;
}

/** Fold a notification delta into the active-alert map; `normal`/empty clears it. */
export function reduceAlerts(
  prev: Record<string, IAlert>,
  key: string,
  value: unknown,
): Record<string, IAlert> {
  const v = (value ?? null) as {
    state?: unknown;
    message?: unknown;
    method?: unknown;
    status?: { acknowledged?: unknown };
  } | null;
  const state = typeof v?.state === 'string' ? v.state : 'normal';
  if (v === null || state === 'normal' || state === 'nominal') {
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  }
  const method = Array.isArray(v.method) ? v.method : [];
  return {
    ...prev,
    [key]: {
      key,
      state,
      message: typeof v.message === 'string' ? v.message : '',
      silenced: method.length === 0 || v.status?.acknowledged === true,
    },
  };
}

export type TStreamState = 'connecting' | 'live' | 'reconnecting';

/** The WebSocket surface the stream uses (injectable for tests; jsdom ships none). */
export interface ISocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface ISkStreamOptions {
  /** Absolute-path stream URL, e.g. `ws://host/signalk/v1/stream?subscribe=none`. */
  url: string;
  onDelta: (values: IDeltaValue[]) => void;
  onState?: (state: TStreamState) => void;
  /** Fired on every successful (re)open — reseed REST state here before trusting deltas. */
  onConnect?: () => void;
  makeSocket?: (url: string) => ISocketLike;
  reconnectBaseMs?: number;
  maxBackoffMs?: number;
  /** No frame for this long → treat the socket as dead and reconnect. */
  stallMs?: number;
  random?: () => number;
}

const SUBSCRIBE = {
  context: 'vessels.self',
  subscribe: [
    { path: 'notifications.sk-video.*', policy: 'instant' },
    { path: 'notifications.cameras.*', policy: 'instant' },
    { path: 'navigation.position', period: 2000 },
    { path: 'navigation.headingTrue', period: 2000 },
    { path: 'navigation.headingMagnetic', period: 2000 },
    { path: 'navigation.speedOverGround', period: 2000 },
  ],
};

export class SkStream {
  private socket: ISocketLike | null = null;
  private stopped = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: ISkStreamOptions) {}

  start(): void {
    this.stopped = false;
    this.open('connecting');
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.socket?.close();
    this.socket = null;
  }

  /**
   * Pause or resume the stream without discarding it. Pausing closes the socket and halts reconnects
   * — used while the session is blocked (re-auth / sign-in / sign-out) so a lapsed cookie doesn't
   * loop 401ing handshakes; resuming reopens once the session is usable. Idempotent.
   */
  setActive(active: boolean): void {
    if (active === !this.stopped) return; // already in the desired state
    if (active) {
      this.start();
    } else {
      this.stop();
    }
  }

  private open(state: TStreamState): void {
    if (this.stopped) return;
    this.opts.onState?.(state);
    const makeSocket =
      this.opts.makeSocket ?? ((url: string) => new WebSocket(url) as unknown as ISocketLike);
    let socket: ISocketLike;
    try {
      socket = makeSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      socket.send(JSON.stringify(SUBSCRIBE));
      this.opts.onState?.('live');
      this.opts.onConnect?.();
      this.armStall();
    };
    socket.onmessage = (ev) => {
      this.armStall();
      const values = parseDeltaValues(ev.data);
      if (values.length > 0) {
        this.opts.onDelta(values);
      }
    };
    socket.onclose = () => this.scheduleReconnect();
    socket.onerror = () => {
      /* the close event follows and drives the reconnect */
    };
  }

  private armStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    const stallMs = this.opts.stallMs ?? 90_000;
    this.stallTimer = setTimeout(() => {
      // A silent socket is indistinguishable from a dead one — recycle it.
      this.socket?.close();
    }, stallMs);
    (this.stallTimer as { unref?: () => void }).unref?.();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.socket = null;
    this.attempts += 1;
    const base = this.opts.reconnectBaseMs ?? 1000;
    const max = this.opts.maxBackoffMs ?? 15_000;
    const backoff = Math.min(max, base * 2 ** Math.min(this.attempts - 1, 6));
    const jitter = (this.opts.random ?? Math.random)() * 0.3 * backoff;
    this.opts.onState?.('reconnecting');
    this.reconnectTimer = setTimeout(() => this.open('reconnecting'), backoff + jitter);
  }
}

/** The same-origin stream URL for the current page (ws/wss follows http/https). */
export function streamUrl(loc: { protocol: string; host: string }, skRoot: string): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.host}${skRoot}/signalk/v1/stream?subscribe=none`;
}
