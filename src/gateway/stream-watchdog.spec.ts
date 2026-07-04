import { describe, it, expect } from 'vitest';
import {
  stepWatch,
  initialWatchState,
  StreamWatchdog,
  DEFAULT_WATCHDOG_THRESHOLDS,
  type IStreamWatchdogDeps,
  type IWatchSample,
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

/**
 * Telemetry sampling: every poll reports a per-camera sample (online, producer/consumer counts,
 * and the debounced feed-outage gauge) so the plugin can publish camera health into Signal K.
 * The gauge must inherit the watchdog's hysteresis — a single healthy blip during an outage must
 * NOT reset it — and must be null for a camera never seen online (lazy-connect honesty).
 */
describe('StreamWatchdog — telemetry samples & feed-outage gauge', () => {
  function makeHarness(
    opts: {
      eligible?: (id: string) => boolean;
      seedAnchors?: Record<string, number>;
      startAt?: number;
    } = {},
  ) {
    let now = opts.startAt ?? 0;
    const online: Record<string, boolean> = {};
    const samples: { id: string; sample: IWatchSample }[] = [];
    const raised: string[] = [];
    const cleared: string[] = [];
    const watchdog = new StreamWatchdog({
      getMonitoredCameras: () => Object.keys(online),
      isAlarmEligible: opts.eligible,
      fetchHealth: async (id) => health(online[id] ?? false),
      raiseNotification: (id) => raised.push(id),
      clearNotification: (id) => cleared.push(id),
      onSample: (id, sample) => samples.push({ id, sample }),
      now: () => now,
      seedAnchors: opts.seedAnchors,
      thresholds: TH,
    });
    return {
      watchdog,
      set: (id: string, v: boolean) => (online[id] = v),
      tick: (ms: number) => (now += ms),
      lastSample: (id: string) => [...samples].reverse().find((s) => s.id === id)?.sample,
      samples,
      raised,
      cleared,
    };
  }

  it('reports a null gauge for a camera never seen online, passing counts through', async () => {
    const h = makeHarness();
    h.set('bow', false);
    await h.watchdog.poll();
    expect(h.lastSample('bow')).toEqual({
      online: false,
      producers: 0,
      consumers: 0,
      feedOutageSeconds: null,
    });
  });

  it('reports a zero gauge while a camera stays healthy', async () => {
    const h = makeHarness();
    h.set('bow', true);
    await h.watchdog.poll();
    h.tick(15_000);
    await h.watchdog.poll();
    expect(h.lastSample('bow')?.feedOutageSeconds).toBe(0);
    expect(h.lastSample('bow')?.producers).toBe(1);
  });

  it('climbs through an outage and ignores a single healthy blip while alarmed', async () => {
    const h = makeHarness();
    h.set('bow', true);
    await h.watchdog.poll(); // healthy at t=0, anchor stamped
    h.set('bow', false);
    for (const expected of [15, 30, 45]) {
      h.tick(15_000);
      await h.watchdog.poll();
      expect(h.lastSample('bow')?.feedOutageSeconds).toBe(expected);
    }
    expect(h.raised).toEqual(['bow']); // alarmed on the 3rd dark poll
    // One healthy blip must not reset the gauge (recovery needs recoverThreshold polls).
    h.set('bow', true);
    h.tick(15_000);
    await h.watchdog.poll();
    expect(h.lastSample('bow')?.feedOutageSeconds).toBe(60);
    expect(h.cleared).toEqual([]);
    // Straight back to dark: still one alarm, gauge still climbing.
    h.set('bow', false);
    h.tick(15_000);
    await h.watchdog.poll();
    expect(h.lastSample('bow')?.feedOutageSeconds).toBe(75);
    expect(h.raised).toEqual(['bow']);
  });

  it('resets the gauge only after a debounced recovery, alongside the alarm clear', async () => {
    const h = makeHarness();
    h.set('bow', true);
    await h.watchdog.poll();
    h.set('bow', false);
    for (let i = 0; i < 3; i += 1) {
      h.tick(15_000);
      await h.watchdog.poll();
    }
    h.set('bow', true);
    h.tick(15_000);
    await h.watchdog.poll(); // 1st healthy: not yet
    h.tick(15_000);
    await h.watchdog.poll(); // 2nd healthy: recovered
    expect(h.cleared).toEqual(['bow']);
    expect(h.lastSample('bow')?.feedOutageSeconds).toBe(0);
  });

  it('lets a persisted anchor alarm a camera that died across a restart', async () => {
    // Fresh process: the camera has never been seen online in-memory, but a persisted
    // last-good stamp proves it WAS live once — so a dead camera must still alarm.
    const h = makeHarness({ seedAnchors: { bow: 0 }, startAt: 100_000 });
    h.set('bow', false);
    for (let i = 0; i < 3; i += 1) {
      h.tick(15_000);
      await h.watchdog.poll();
    }
    expect(h.raised).toEqual(['bow']);
    expect(h.lastSample('bow')?.feedOutageSeconds).toBe(145); // measured from the persisted stamp
  });

  it('samples alarm-ineligible cameras but never raises for them', async () => {
    const h = makeHarness({ eligible: () => false });
    h.set('bow', true);
    await h.watchdog.poll();
    h.set('bow', false);
    for (let i = 0; i < 4; i += 1) {
      h.tick(15_000);
      await h.watchdog.poll();
    }
    expect(h.raised).toEqual([]);
    expect(h.lastSample('bow')?.feedOutageSeconds).toBe(60); // telemetry still flows
  });

  it('clears its own alarm when a camera loses alarm eligibility mid-outage', async () => {
    const eligible = new Set(['bow']);
    const h = makeHarness({ eligible: (id) => eligible.has(id) });
    h.set('bow', true);
    await h.watchdog.poll();
    h.set('bow', false);
    for (let i = 0; i < 3; i += 1) {
      h.tick(15_000);
      await h.watchdog.poll();
    }
    expect(h.raised).toEqual(['bow']);
    eligible.delete('bow'); // e.g. the user handed this camera's alarm to server zones
    h.tick(15_000);
    await h.watchdog.poll();
    expect(h.cleared).toEqual(['bow']); // our alarm must not linger under the new authority
  });
});
