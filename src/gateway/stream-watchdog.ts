import type { IStreamHealth } from './stream-health';

/**
 * Watches go2rtc health for the enabled cameras: it samples per-camera telemetry (online,
 * producer/viewer counts, and a feed-outage gauge) every poll, and raises/clears a debounced
 * Signal K notification when an alarm-eligible camera goes dark. It is EDGE-aware: go2rtc connects
 * to a source lazily, so a camera nobody is watching reads as offline — to avoid false alarms, a
 * camera must have been seen online at least once (in this process, or via a persisted last-good
 * anchor from an earlier run) before it can alarm, and the alarm only fires after N consecutive
 * unhealthy polls (and clears after N consecutive healthy ones). Hysteresis is mandatory so a flaky
 * marina link doesn't spam notifications — and the gauge inherits it: a single healthy blip during
 * an outage does not reset the anchor, so the published seconds keep climbing until a debounced
 * recovery. The health fetch + clock are injected so the orchestration is unit-testable.
 */

export interface IWatchdogThresholds {
  /** Consecutive unhealthy polls before raising the alarm. */
  failThreshold: number;
  /** Consecutive healthy polls before clearing it. */
  recoverThreshold: number;
}

export const DEFAULT_WATCHDOG_THRESHOLDS: IWatchdogThresholds = {
  failThreshold: 3,
  recoverThreshold: 2,
};

export interface ICameraWatchState {
  /** Has this camera ever been seen online? Until then a "dark" reading is just "idle", not a fault. */
  seenOnline: boolean;
  consecutiveUnhealthy: number;
  consecutiveHealthy: number;
  alarmed: boolean;
  /**
   * Epoch ms of the last CONFIRMED-healthy poll — the feed-outage gauge's zero point. Frozen while
   * alarmed (a single blip must not reset the gauge); null until first seen online.
   */
  anchorMs: number | null;
}

export function initialWatchState(anchorMs: number | null = null): ICameraWatchState {
  return {
    seenOnline: anchorMs !== null,
    consecutiveUnhealthy: 0,
    consecutiveHealthy: 0,
    alarmed: false,
    anchorMs,
  };
}

export type TWatchAction = 'raise' | 'clear' | 'none';

/**
 * Pure transition for one camera given a poll's online flag. Returns the next state and the edge
 * action to take. Never alarms a camera that has not yet been seen online (lazy-connect guard).
 * The anchor advances only on a healthy poll that leaves the camera un-alarmed, so the gauge
 * derived from it inherits the recover-threshold debounce.
 */
export function stepWatch(
  prev: ICameraWatchState,
  online: boolean,
  thresholds: IWatchdogThresholds,
  nowMs = 0,
): { state: ICameraWatchState; action: TWatchAction } {
  if (online) {
    const state: ICameraWatchState = {
      seenOnline: true,
      consecutiveUnhealthy: 0,
      consecutiveHealthy: prev.consecutiveHealthy + 1,
      alarmed: prev.alarmed,
      anchorMs: prev.anchorMs,
    };
    if (prev.alarmed && state.consecutiveHealthy >= thresholds.recoverThreshold) {
      return {
        state: { ...state, alarmed: false, consecutiveHealthy: 0, anchorMs: nowMs },
        action: 'clear',
      };
    }
    return { state: state.alarmed ? state : { ...state, anchorMs: nowMs }, action: 'none' };
  }

  const state: ICameraWatchState = {
    seenOnline: prev.seenOnline,
    consecutiveUnhealthy: prev.consecutiveUnhealthy + 1,
    consecutiveHealthy: 0,
    alarmed: prev.alarmed,
    anchorMs: prev.anchorMs,
  };
  // Only a camera that was once live can "go dark"; never alarm a never-started/idle camera.
  if (prev.seenOnline && !prev.alarmed && state.consecutiveUnhealthy >= thresholds.failThreshold) {
    return { state: { ...state, alarmed: true }, action: 'raise' };
  }
  return { state, action: 'none' };
}

/** One camera's telemetry from a poll — the raw material for Signal K health paths. */
export interface IWatchSample {
  online: boolean;
  producers: number;
  consumers: number;
  /** Seconds since the last confirmed-healthy poll; null until the camera is first seen online. */
  feedOutageSeconds: number | null;
}

export interface IStreamWatchdogDeps {
  /** Ids of the cameras to watch (re-read each poll, so config changes are picked up). */
  getMonitoredCameras: () => string[];
  /**
   * May this camera's outage raise OUR notification? Telemetry flows either way. Defaults to
   * always-eligible; the caller scopes it (safety-critical only, or handed over to server zones).
   */
  isAlarmEligible?: (id: string) => boolean;
  fetchHealth: (id: string) => Promise<IStreamHealth>;
  raiseNotification: (cameraId: string) => void;
  clearNotification: (cameraId: string) => void;
  /** Per-camera, per-poll telemetry tap (drives the Signal K camera health deltas). */
  onSample?: (cameraId: string, sample: IWatchSample) => void;
  /** Persisted last-good stamps (epoch ms) seeding the gauge anchor across restarts. */
  seedAnchors?: Record<string, number>;
  now?: () => number;
  thresholds?: IWatchdogThresholds;
  log?: (msg: string) => void;
}

export class StreamWatchdog {
  private readonly states = new Map<string, ICameraWatchState>();
  /** Cameras whose CURRENT alarm we raised — the only ones we may clear. */
  private readonly raisedByUs = new Set<string>();
  private readonly thresholds: IWatchdogThresholds;
  private readonly now: () => number;

  constructor(private readonly deps: IStreamWatchdogDeps) {
    this.thresholds = deps.thresholds ?? DEFAULT_WATCHDOG_THRESHOLDS;
    this.now = deps.now ?? (() => Date.now());
  }

  /** One poll cycle: fetch each monitored camera's health and apply the hysteresis state machine. */
  async poll(): Promise<void> {
    const monitored = new Set(this.deps.getMonitoredCameras());
    // Forget cameras no longer monitored (and clear any alarm we hold for them).
    for (const id of [...this.states.keys()]) {
      if (!monitored.has(id)) {
        if (this.raisedByUs.has(id)) {
          this.safeClear(id);
        }
        this.states.delete(id);
      }
    }

    for (const id of monitored) {
      let health: Pick<IStreamHealth, 'online' | 'producers' | 'consumers'>;
      try {
        health = await this.deps.fetchHealth(id);
      } catch {
        health = { online: false, producers: 0, consumers: 0 }; // unreachable gateway = unhealthy
      }
      const prev = this.states.get(id) ?? initialWatchState(this.deps.seedAnchors?.[id] ?? null);
      const { state, action } = stepWatch(prev, health.online, this.thresholds, this.now());
      this.states.set(id, state);

      const eligible = this.deps.isAlarmEligible?.(id) ?? true;
      if (!eligible && this.raisedByUs.has(id)) {
        // The alarm's authority moved elsewhere (e.g. user-enabled server zones) — ours must not linger.
        this.safeClear(id);
      } else if (action === 'raise' && eligible) {
        this.safeRaise(id);
      } else if (action === 'clear' && this.raisedByUs.has(id)) {
        this.safeClear(id);
      }

      this.deps.onSample?.(id, {
        online: health.online,
        producers: health.producers,
        consumers: health.consumers,
        feedOutageSeconds:
          state.anchorMs === null
            ? null
            : Math.max(0, Math.round((this.now() - state.anchorMs) / 1000)),
      });
    }
  }

  /** Cameras currently in the alarmed state. */
  alarmedCameras(): string[] {
    return [...this.states.entries()].filter(([, s]) => s.alarmed).map(([id]) => id);
  }

  /** Clear all state + any outstanding alarms we raised (call on stop, while the bridge is live). */
  reset(): void {
    for (const id of [...this.raisedByUs]) {
      this.safeClear(id);
    }
    this.states.clear();
  }

  private safeRaise(id: string): void {
    try {
      this.deps.raiseNotification(id);
      this.raisedByUs.add(id);
    } catch (err) {
      this.deps.log?.(`watchdog raise failed for ${id}: ${errMessage(err)}`);
    }
  }

  private safeClear(id: string): void {
    try {
      this.deps.clearNotification(id);
      this.raisedByUs.delete(id);
    } catch (err) {
      this.deps.log?.(`watchdog clear failed for ${id}: ${errMessage(err)}`);
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
