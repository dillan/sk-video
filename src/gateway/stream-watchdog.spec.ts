import { describe, it, expect } from 'vitest';
import {
  stepWatch,
  initialWatchState,
  StreamWatchdog,
  DEFAULT_WATCHDOG_THRESHOLDS,
  type IStreamWatchdogDeps,
} from './stream-watchdog';
import type { IStreamHealth } from './stream-health';

const TH = { failThreshold: 3, recoverThreshold: 2 };
const health = (online: boolean): IStreamHealth => ({
  online,
  producers: online ? 1 : 0,
  consumers: 0,
  codecs: [],
  sources: [],
});

describe('stepWatch', () => {
  it('never alarms a camera that has not been seen online (lazy-connect guard)', () => {
    let s = initialWatchState();
    for (let i = 0; i < 5; i += 1) {
      const r = stepWatch(s, false, TH);
      s = r.state;
      expect(r.action).toBe('none'); // idle/never-started camera stays quiet
    }
    expect(s.alarmed).toBe(false);
  });

  it('raises only after failThreshold consecutive unhealthy polls following a healthy one', () => {
    let s = stepWatch(initialWatchState(), true, TH).state; // seen online
    const actions: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = stepWatch(s, false, TH);
      s = r.state;
      actions.push(r.action);
    }
    expect(actions).toEqual(['none', 'none', 'raise']); // raise on the 3rd
    expect(s.alarmed).toBe(true);
  });

  it('clears only after recoverThreshold consecutive healthy polls', () => {
    // Drive to alarmed.
    let s = stepWatch(initialWatchState(), true, TH).state;
    for (let i = 0; i < 3; i += 1) s = stepWatch(s, false, TH).state;
    expect(s.alarmed).toBe(true);
    const r1 = stepWatch(s, true, TH);
    expect(r1.action).toBe('none'); // 1 healthy, not enough
    const r2 = stepWatch(r1.state, true, TH);
    expect(r2.action).toBe('clear'); // 2nd healthy clears
    expect(r2.state.alarmed).toBe(false);
  });

  it('does not re-raise while already alarmed (no spam on a flaky link)', () => {
    let s = stepWatch(initialWatchState(), true, TH).state;
    for (let i = 0; i < 3; i += 1) s = stepWatch(s, false, TH).state; // alarmed
    for (let i = 0; i < 5; i += 1) {
      const r = stepWatch(s, false, TH);
      s = r.state;
      expect(r.action).toBe('none');
    }
  });
});

function setup(over: Partial<IStreamWatchdogDeps> = {}) {
  const raised: string[] = [];
  const cleared: string[] = [];
  let onlineById: Record<string, boolean> = {};
  const deps: IStreamWatchdogDeps = {
    getMonitoredCameras: () => Object.keys(onlineById),
    fetchHealth: async (id) => health(onlineById[id] ?? false),
    raiseNotification: (id) => raised.push(id),
    clearNotification: (id) => cleared.push(id),
    thresholds: TH,
    ...over,
  };
  const watchdog = new StreamWatchdog(deps);
  return {
    watchdog,
    raised,
    cleared,
    setOnline: (map: Record<string, boolean>) => (onlineById = map),
  };
}

describe('StreamWatchdog', () => {
  it('raises a debounced notification when a live safety camera goes dark, and clears on recovery', async () => {
    const h = setup();
    h.setOnline({ bow: true });
    await h.watchdog.poll(); // seen online
    h.setOnline({ bow: false });
    await h.watchdog.poll();
    await h.watchdog.poll();
    expect(h.raised).toEqual([]); // debounced, not yet
    await h.watchdog.poll();
    expect(h.raised).toEqual(['bow']); // 3rd dark poll
    expect(h.watchdog.alarmedCameras()).toEqual(['bow']);

    h.setOnline({ bow: true });
    await h.watchdog.poll();
    await h.watchdog.poll();
    expect(h.cleared).toEqual(['bow']);
    expect(h.watchdog.alarmedCameras()).toEqual([]);
  });

  it('treats an unreachable gateway (fetch throw) as unhealthy and eventually raises', async () => {
    let throwing = false;
    const raised: string[] = [];
    const watchdog = new StreamWatchdog({
      getMonitoredCameras: () => ['bow'],
      fetchHealth: async () => {
        if (throwing) throw new Error('gateway down');
        return health(true);
      },
      raiseNotification: (id) => raised.push(id),
      clearNotification: () => undefined,
      thresholds: TH,
    });
    await watchdog.poll(); // seen online
    throwing = true;
    await watchdog.poll();
    await watchdog.poll();
    await watchdog.poll();
    expect(raised).toEqual(['bow']); // 3 consecutive failed fetches -> dark -> raise
  });

  it('forgets and clears a camera that is no longer monitored', async () => {
    const h = setup();
    h.setOnline({ bow: true });
    await h.watchdog.poll();
    h.setOnline({ bow: false });
    await h.watchdog.poll();
    await h.watchdog.poll();
    await h.watchdog.poll(); // alarmed
    expect(h.watchdog.alarmedCameras()).toEqual(['bow']);
    h.setOnline({}); // bow de-tagged
    await h.watchdog.poll();
    expect(h.cleared).toContain('bow');
    expect(h.watchdog.alarmedCameras()).toEqual([]);
  });

  it('reset() clears outstanding alarms and all state', async () => {
    const h = setup();
    h.setOnline({ bow: true });
    await h.watchdog.poll();
    h.setOnline({ bow: false });
    await h.watchdog.poll();
    await h.watchdog.poll();
    await h.watchdog.poll();
    h.watchdog.reset();
    expect(h.cleared).toContain('bow');
    expect(h.watchdog.alarmedCameras()).toEqual([]);
  });

  it('uses sane default thresholds when none are injected', () => {
    expect(DEFAULT_WATCHDOG_THRESHOLDS.failThreshold).toBeGreaterThanOrEqual(2);
  });
});
