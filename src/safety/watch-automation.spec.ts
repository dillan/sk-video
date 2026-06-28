import { describe, it, expect } from 'vitest';
import {
  WatchAutomation,
  isAlarmDelta,
  selectWatchCameras,
  type IWatchAutomationDeps,
  type IWatchCamera,
} from './watch-automation';

const ALARM = ['alert', 'alarm', 'emergency'];

describe('isAlarmDelta', () => {
  it('is true only for an object whose state is an alarm state', () => {
    expect(isAlarmDelta({ state: 'alarm' }, ALARM)).toBe(true);
    expect(isAlarmDelta({ state: 'emergency' }, ALARM)).toBe(true);
    expect(isAlarmDelta({ state: 'normal' }, ALARM)).toBe(false);
    expect(isAlarmDelta('alarm', ALARM)).toBe(false);
    expect(isAlarmDelta(null, ALARM)).toBe(false);
  });
});

describe('selectWatchCameras', () => {
  const cameras: IWatchCamera[] = [
    { id: 'bow', role: 'anchor', enabled: true },
    { id: 'aft', role: 'security', enabled: true },
    { id: 'helm', role: 'navigation', enabled: true },
    { id: 'off', role: 'anchor', enabled: false },
  ];
  it('returns enabled anchor/security cameras only', () => {
    expect(selectWatchCameras(cameras, ['anchor', 'security'])).toEqual(['bow', 'aft']);
  });
});

function setup(over: Partial<IWatchAutomationDeps> = {}) {
  const calls = {
    captured: [] as { cameras: string[]; context: { path: string; state: string } }[],
    raised: [] as { message: string; data: Record<string, unknown> }[],
    cleared: 0,
  };
  let clock = 1000;
  const deps: IWatchAutomationDeps = {
    getCameras: () => [
      { id: 'bow', role: 'anchor', enabled: true },
      { id: 'helm', role: 'navigation', enabled: true },
    ],
    captureEvidence: (cameras, context) => {
      calls.captured.push({ cameras, context });
      return 'inc-1';
    },
    raiseNotification: (message, data) => calls.raised.push({ message, data }),
    clearNotification: () => (calls.cleared += 1),
    now: () => clock,
    ...over,
  };
  const watch = new WatchAutomation(deps);
  return { watch, calls, setClock: (t: number) => (clock = t) };
}

describe('WatchAutomation', () => {
  it('captures evidence + raises a consolidated notification on the rising alarm edge only', () => {
    const { watch, calls } = setup();
    const delta = {
      path: 'notifications.navigation.anchor',
      value: { state: 'alarm', message: 'dragging' },
    };
    watch.onNotification(delta);
    watch.onNotification(delta); // still alarming — must NOT re-capture
    expect(calls.captured).toHaveLength(1);
    expect(calls.captured[0].cameras).toEqual(['bow']); // only the anchor-role camera
    expect(calls.raised).toHaveLength(1);
    expect(calls.raised[0].data).toMatchObject({
      triggerPath: 'notifications.navigation.anchor',
      incident: 'inc-1',
      cameras: ['bow'],
    });
    expect(watch.activePaths()).toEqual(['notifications.navigation.anchor']);
  });

  it('switches the watched cameras to low light on a dark rising edge, but not in daylight', () => {
    const dark: string[][] = [];
    const atNight = setup({ isDark: () => true, applyLowLight: (ids) => dark.push(ids) });
    atNight.watch.onNotification({ path: 'p1', value: { state: 'alarm' } });
    expect(dark).toEqual([['bow']]); // the anchor camera, switched to low light

    const byDay = setup({ isDark: () => false, applyLowLight: (ids) => dark.push(ids) });
    byDay.watch.onNotification({ path: 'p2', value: { state: 'alarm' } });
    expect(dark).toEqual([['bow']]); // unchanged — daylight leaves imaging alone
  });

  it('clears the consolidated notification when the alarm returns to normal', () => {
    const { watch, calls } = setup();
    const path = 'notifications.navigation.anchor';
    watch.onNotification({ path, value: { state: 'alarm' } });
    watch.onNotification({ path, value: { state: 'normal' } });
    expect(calls.cleared).toBe(1);
    expect(watch.activePaths()).toEqual([]);
  });

  it('only clears once every watched path has returned to normal', () => {
    const { watch, calls } = setup();
    watch.onNotification({ path: 'notifications.navigation.anchor', value: { state: 'alarm' } });
    watch.onNotification({ path: 'notifications.navigation.geofence', value: { state: 'alarm' } });
    watch.onNotification({ path: 'notifications.navigation.anchor', value: { state: 'normal' } });
    expect(calls.cleared).toBe(0); // geofence still alarming
    watch.onNotification({ path: 'notifications.navigation.geofence', value: { state: 'normal' } });
    expect(calls.cleared).toBe(1);
  });

  it('does nothing when no anchor/security cameras are configured', () => {
    const { watch, calls } = setup({
      getCameras: () => [{ id: 'helm', role: 'navigation', enabled: true }],
    });
    watch.onNotification({ path: 'notifications.navigation.anchor', value: { state: 'alarm' } });
    expect(calls.captured).toHaveLength(0);
    expect(calls.raised).toHaveLength(0);
  });

  it('throttles the heavy capture on a flapping alarm but still re-alerts on each re-drag', () => {
    const h = setup({ cooldownMs: 60_000 });
    const path = 'notifications.navigation.anchor';
    h.watch.onNotification({ path, value: { state: 'alarm' } }); // capture + alert at t=1000
    h.watch.onNotification({ path, value: { state: 'normal' } });
    h.setClock(20_000); // 19 s later, still within the capture cooldown
    h.watch.onNotification({ path, value: { state: 'alarm' } });
    expect(h.calls.captured).toHaveLength(1); // heavy capture suppressed...
    expect(h.calls.raised).toHaveLength(2); // ...but the operator is re-alerted
    expect(h.calls.raised[1].data.incident).toBeUndefined(); // no new bundle on the throttled re-alarm
    h.setClock(100_000); // well past the cooldown
    h.watch.onNotification({ path, value: { state: 'normal' } });
    h.watch.onNotification({ path, value: { state: 'alarm' } });
    expect(h.calls.captured).toHaveLength(2);
  });

  it('reset() clears edge/cooldown state AND any outstanding consolidated notification', () => {
    const { watch, calls } = setup();
    watch.onNotification({ path: 'notifications.navigation.anchor', value: { state: 'alarm' } });
    expect(calls.cleared).toBe(0);
    watch.reset(); // e.g. on plugin stop, while an anchor alarm was still active
    expect(calls.cleared).toBe(1); // the stale on-bus notification is cleared
    expect(watch.activePaths()).toEqual([]);
  });

  it('swallows a throwing notifications API so it cannot escape into the bus subscription', () => {
    const { watch } = setup({
      raiseNotification: () => {
        throw new Error('notifications API down');
      },
    });
    expect(() =>
      watch.onNotification({ path: 'notifications.navigation.anchor', value: { state: 'alarm' } }),
    ).not.toThrow();
  });
});
