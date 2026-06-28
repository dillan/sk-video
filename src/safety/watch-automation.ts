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
  /** Whether it is currently dark enough that a low-light camera preset would help (dusk/night). */
  isDark?: () => boolean;
  /** Apply the low-light imaging preset to the given cameras (best-effort; capability-gated upstream). */
  applyLowLight?: (cameraIds: string[]) => void;
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
  private readonly lastCaptureAt = new Map<string, number>(); // capture cooldown, per path
  private notificationActive = false; // is a consolidated 'anchorWatch' notification outstanding?
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

  /**
   * Process a notification delta: alert + capture on a rising alarm edge, clear on the falling edge.
   * Wrapped so a throwing notifications API can never escape into the bus subscription that drives it.
   */
  onNotification(delta: IWatchDelta): void {
    try {
      this.process(delta);
    } catch (err) {
      this.deps.log?.(`watch automation error on ${delta.path}: ${errMessage(err)}`);
    }
  }

  activePaths(): string[] {
    return [...this.active];
  }

  /**
   * Clear edge/cooldown state AND any outstanding consolidated notification, so a clean shutdown
   * doesn't leave a stale 'anchorWatch' alarm on the bus (at stop() the bridge is still live).
   */
  reset(): void {
    this.clearConsolidated();
    this.active.clear();
    this.lastCaptureAt.clear();
  }

  private process(delta: IWatchDelta): void {
    if (isAlarmDelta(delta.value, this.alarmStates)) {
      if (this.active.has(delta.path)) {
        return; // already alarming on this path
      }
      this.active.add(delta.path);
      this.onRisingEdge(delta);
    } else {
      if (!this.active.delete(delta.path)) {
        return; // this path wasn't alarming
      }
      if (this.active.size === 0) {
        this.clearConsolidated(); // every watched alarm has cleared
      }
    }
  }

  private onRisingEdge(delta: IWatchDelta): void {
    const cameras = selectWatchCameras(this.deps.getCameras(), this.roles);
    if (cameras.length === 0) {
      this.deps.log?.(
        `watch alarm on ${delta.path}, but no anchor/security cameras are configured`,
      );
      return; // nothing to capture or consolidate; the user's own alarm stands
    }
    const state = stateOf(delta.value);
    // After dusk, switch the watched cameras to low light before capturing, so the evidence is as
    // usable as the hardware allows. Best-effort and capability-gated; runs every rising edge (cheap).
    if (this.deps.isDark?.()) {
      this.deps.applyLowLight?.(cameras);
    }
    // The operator ALERT fires on every rising edge (a re-drag must be visible); the heavy evidence
    // CAPTURE is throttled per path so a flapping alarm can't spawn repeated recordings.
    const now = this.now();
    const last = this.lastCaptureAt.get(delta.path);
    let incident: string | null = null;
    if (last === undefined || now - last > this.cooldownMs) {
      this.lastCaptureAt.set(delta.path, now);
      incident = this.deps.captureEvidence(cameras, { path: delta.path, state });
    }
    this.notificationActive = true;
    this.deps.raiseNotification(
      `Anchor/geofence alarm — ${cameras.length} camera${cameras.length === 1 ? '' : 's'}${incident ? ' (evidence captured)' : ''}.`,
      { triggerPath: delta.path, state, cameras, ...(incident ? { incident } : {}) },
    );
  }

  private clearConsolidated(): void {
    if (this.notificationActive) {
      this.notificationActive = false;
      this.deps.clearNotification();
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
