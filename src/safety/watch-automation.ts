/**
 * Anchor-watch & unattended-vessel automation. It CONSUMES an anchor-drag / geofence alarm the user
 * already produces (a Signal K Anchor API or another plugin) — it does NOT compute drag itself. On the
 * rising edge of an alarm (a non-alarm → alarm transition on a watched notification path) it captures
 * evidence on the role-tagged anchor/security cameras and raises a single consolidated notification;
 * on the falling edge it clears that notification. A per-path cooldown guards against a flapping alarm.
 * Local evidence + an on-bus alert, not a monitored service.
 */

const DEFAULT_ALARM_STATES = ['alert', 'alarm', 'emergency'];
const DEFAULT_WATCH_ROLES = ['anchor', 'security'];
const DEFAULT_COOLDOWN_MS = 60_000;

export interface IWatchCamera {
  id: string;
  role?: string;
  enabled: boolean;
}

export interface IWatchDelta {
  path: string;
  value: unknown;
}

export interface IWatchAutomationDeps {
  getCameras: () => IWatchCamera[];
  /** Capture evidence on the given cameras; returns an incident bundle id, or null if it couldn't. */
  captureEvidence: (cameraIds: string[], context: { path: string; state: string }) => string | null;
  raiseNotification: (message: string, data: Record<string, unknown>) => void;
  clearNotification: () => void;
  /** Camera roles to capture on. Default ['anchor', 'security']. */
  roles?: string[];
  /** Notification states treated as an alarm. Default ['alert', 'alarm', 'emergency']. */
  alarmStates?: string[];
  /** Minimum time between captures for the same path, to absorb a flapping alarm. Default 60 s. */
  cooldownMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/** True when a notification delta's value carries an alarm-ish state. */
export function isAlarmDelta(value: unknown, alarmStates: string[]): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const state = (value as { state?: unknown }).state;
  return typeof state === 'string' && alarmStates.includes(state);
}

/** The enabled cameras whose role the watch captures on (anchor/security). */
export function selectWatchCameras(cameras: IWatchCamera[], roles: string[]): string[] {
  return cameras
    .filter((c) => c.enabled && c.role !== undefined && roles.includes(c.role))
    .map((c) => c.id);
}

function stateOf(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const s = (value as { state?: unknown }).state;
    if (typeof s === 'string') {
      return s;
    }
  }
  return 'alarm';
}

export class WatchAutomation {
  private readonly active = new Set<string>(); // paths currently in alarm (edge state)
  private readonly lastFiredAt = new Map<string, number>();
  private readonly roles: string[];
  private readonly alarmStates: string[];
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: IWatchAutomationDeps) {
    this.roles = deps.roles ?? DEFAULT_WATCH_ROLES;
    this.alarmStates = deps.alarmStates ?? DEFAULT_ALARM_STATES;
    this.cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Capture on a rising alarm edge; clear the consolidated notification on the falling edge. */
  onNotification(delta: IWatchDelta): void {
    if (isAlarmDelta(delta.value, this.alarmStates)) {
      if (this.active.has(delta.path)) {
        return; // already alarming on this path — don't re-capture
      }
      this.active.add(delta.path);
      this.fire(delta);
    } else {
      if (!this.active.delete(delta.path)) {
        return; // this path wasn't alarming
      }
      if (this.active.size === 0) {
        this.deps.clearNotification(); // every watched alarm has cleared
      }
    }
  }

  activePaths(): string[] {
    return [...this.active];
  }

  /** Clear edge state on shutdown so a restart doesn't believe a stale alarm is still active. */
  reset(): void {
    this.active.clear();
    this.lastFiredAt.clear();
  }

  private fire(delta: IWatchDelta): void {
    const now = this.now();
    const last = this.lastFiredAt.get(delta.path);
    if (last !== undefined && now - last <= this.cooldownMs) {
      return; // flapping within the cooldown — skip the duplicate capture
    }
    const cameras = selectWatchCameras(this.deps.getCameras(), this.roles);
    if (cameras.length === 0) {
      this.deps.log?.(
        `watch alarm on ${delta.path}, but no anchor/security cameras are configured`,
      );
      return; // nothing to capture; the user's own alarm stands
    }
    this.lastFiredAt.set(delta.path, now);
    const state = stateOf(delta.value);
    const incident = this.deps.captureEvidence(cameras, { path: delta.path, state });
    this.deps.raiseNotification(
      `Anchor/geofence alarm — captured evidence on ${cameras.length} camera${cameras.length === 1 ? '' : 's'}.`,
      { triggerPath: delta.path, state, cameras, ...(incident ? { incident } : {}) },
    );
  }
}
