import type { IStreamHealth } from './stream-health';

/**
 * Watches the go2rtc health of safety-critical cameras and raises/clears a debounced Signal K
 * notification when one goes dark. It is EDGE-aware: go2rtc connects to a source lazily, so a camera
 * nobody is watching reads as offline — to avoid false alarms, a camera must have been seen online at
 * least once before it can alarm, and the alarm only fires after N consecutive unhealthy polls (and
 * clears after N consecutive healthy ones). Hysteresis is mandatory so a flaky marina link doesn't
 * spam notifications. The health fetch + clock are injected so the orchestration is unit-testable.
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
}

export function initialWatchState(): ICameraWatchState {
  return { seenOnline: false, consecutiveUnhealthy: 0, consecutiveHealthy: 0, alarmed: false };
}

export type TWatchAction = 'raise' | 'clear' | 'none';

/**
 * Pure transition for one camera given a poll's online flag. Returns the next state and the edge
 * action to take. Never alarms a camera that has not yet been seen online (lazy-connect guard).
 */
export function stepWatch(
  prev: ICameraWatchState,
  online: boolean,
  thresholds: IWatchdogThresholds,
): { state: ICameraWatchState; action: TWatchAction } {
  if (online) {
    const state: ICameraWatchState = {
      seenOnline: true,
      consecutiveUnhealthy: 0,
      consecutiveHealthy: prev.consecutiveHealthy + 1,
      alarmed: prev.alarmed,
    };
    if (prev.alarmed && state.consecutiveHealthy >= thresholds.recoverThreshold) {
      return { state: { ...state, alarmed: false, consecutiveHealthy: 0 }, action: 'clear' };
    }
    return { state, action: 'none' };
  }

  const state: ICameraWatchState = {
    seenOnline: prev.seenOnline,
    consecutiveUnhealthy: prev.consecutiveUnhealthy + 1,
    consecutiveHealthy: 0,
    alarmed: prev.alarmed,
  };
  // Only a camera that was once live can "go dark"; never alarm a never-started/idle camera.
  if (prev.seenOnline && !prev.alarmed && state.consecutiveUnhealthy >= thresholds.failThreshold) {
    return { state: { ...state, alarmed: true }, action: 'raise' };
  }
  return { state, action: 'none' };
}

export interface IStreamWatchdogDeps {
  /** Ids of the safety-critical cameras to monitor (re-read each poll, so config changes are picked up). */
  getMonitoredCameras: () => string[];
  fetchHealth: (id: string) => Promise<IStreamHealth>;
  raiseNotification: (cameraId: string) => void;
  clearNotification: (cameraId: string) => void;
  thresholds?: IWatchdogThresholds;
  log?: (msg: string) => void;
}

export class StreamWatchdog {
  private readonly states = new Map<string, ICameraWatchState>();
  private readonly thresholds: IWatchdogThresholds;

  constructor(private readonly deps: IStreamWatchdogDeps) {
    this.thresholds = deps.thresholds ?? DEFAULT_WATCHDOG_THRESHOLDS;
  }

  /** One poll cycle: fetch each monitored camera's health and apply the hysteresis state machine. */
  async poll(): Promise<void> {
    const monitored = new Set(this.deps.getMonitoredCameras());
    // Forget cameras no longer monitored (and clear any alarm they held).
    for (const id of [...this.states.keys()]) {
      if (!monitored.has(id)) {
        if (this.states.get(id)?.alarmed) {
          this.safeClear(id);
        }
        this.states.delete(id);
      }
    }

    for (const id of monitored) {
      let online = false;
      try {
        online = (await this.deps.fetchHealth(id)).online;
      } catch {
        online = false; // an unreachable gateway counts as unhealthy
      }
      const prev = this.states.get(id) ?? initialWatchState();
      const { state, action } = stepWatch(prev, online, this.thresholds);
      this.states.set(id, state);
      if (action === 'raise') {
        this.safeRaise(id);
      } else if (action === 'clear') {
        this.safeClear(id);
      }
    }
  }

  /** Cameras currently in the alarmed state. */
  alarmedCameras(): string[] {
    return [...this.states.entries()].filter(([, s]) => s.alarmed).map(([id]) => id);
  }

  /** Clear all state + any outstanding alarms (call on stop, while the bridge is still live). */
  reset(): void {
    for (const [id, state] of this.states) {
      if (state.alarmed) {
        this.safeClear(id);
      }
    }
    this.states.clear();
  }

  private safeRaise(id: string): void {
    try {
      this.deps.raiseNotification(id);
    } catch (err) {
      this.deps.log?.(`watchdog raise failed for ${id}: ${errMessage(err)}`);
    }
  }

  private safeClear(id: string): void {
    try {
      this.deps.clearNotification(id);
    } catch (err) {
      this.deps.log?.(`watchdog clear failed for ${id}: ${errMessage(err)}`);
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
