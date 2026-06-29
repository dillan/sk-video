import { describe, it, expect } from 'vitest';
import { MobController, type IMobControllerDeps, type IMobCamera } from './mob-controller';

const CAL = { pan: { offset: 0, scalePerDeg: 0.01 }, tilt: { offset: 0, scalePerDeg: 0.01 } };
const ptzCam = (id: string): IMobCamera => ({
  id,
  hasAbsolutePtz: true,
  aimConfig: { mountBearingDeg: 0, calibration: CAL },
});
const fixedCam = (id: string): IMobCamera => ({ id, hasAbsolutePtz: false, aimConfig: {} });

function setup(over: Partial<IMobControllerDeps> = {}) {
  let intervalCb: (() => void) | null = null;
  const calls = {
    aims: [] as { id: string; pan: number; tilt: number }[],
    raised: [] as { message: string; position: unknown }[],
    cleared: 0,
    markers: [] as unknown[],
    snapshots: 0,
    clearedInterval: 0,
    recorded: [] as string[][],
    stoppedRecording: 0,
  };
  const deps: IMobControllerDeps = {
    getOwnShip: () => ({ position: { latitude: 0, longitude: 0 }, headingDeg: 0 }),
    getBeaconTarget: () => null,
    getCameras: () => [ptzCam('bow'), fixedCam('engine')],
    aimCamera: (id, pan, tilt) => calls.aims.push({ id, pan, tilt }),
    raiseNotification: (message, position) => calls.raised.push({ message, position }),
    clearNotification: () => calls.cleared++,
    emitMarker: (t) => calls.markers.push(t),
    snapshotAll: () => calls.snapshots++,
    recordCameras: (ids) => calls.recorded.push(ids),
    stopRecording: () => calls.stoppedRecording++,
    setIntervalImpl: (cb) => {
      intervalCb = cb;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalImpl: () => calls.clearedInterval++,
    ...over,
  };
  const mob = new MobController(deps);
  return { mob, calls, tick: () => intervalCb?.() };
}

describe('MobController', () => {
  it('raises an emergency notification, snapshots, drops a marker and aims capable cameras', () => {
    const { mob, calls } = setup();
    const status = mob.activate();

    expect(calls.raised).toHaveLength(1);
    expect(calls.raised[0].message).toMatch(/overboard/i);
    expect(calls.snapshots).toBe(1);
    expect(calls.markers).toHaveLength(1);
    // Heading north, target due east of the datum origin? Datum IS the origin, so aim depends on
    // own-ship drift; at the trigger instant ship==datum so bearing is undefined -> still aims pan 0.
    expect(calls.aims.map((a) => a.id)).toEqual(['bow']); // the fixed camera is skipped
    expect(status).toMatchObject({ active: true, targetSource: 'datum', aimedCameras: 1 });
    expect(mob.isActive()).toBe(true);
  });

  it('status() reports a non-mutating snapshot: idle before, armed after, idle again after deactivate', () => {
    const { mob, calls } = setup();
    expect(mob.status()).toEqual({ active: false, targetSource: 'none', aimedCameras: 0 });

    const status = mob.activate();
    const aimsAfterActivate = calls.aims.length;
    // The read mirrors what activate() reported, and crucially issues NO new camera commands.
    expect(mob.status()).toEqual(status);
    expect(mob.status()).toEqual(status); // idempotent
    expect(calls.aims.length).toBe(aimsAfterActivate);

    mob.deactivate();
    expect(mob.status()).toEqual({ active: false, targetSource: 'none', aimedCameras: 0 });
  });

  it('applies the low-light preset to all cameras on activation when it is dark', () => {
    const lowLight: string[][] = [];
    const { mob } = setup({ isDark: () => true, applyLowLight: (ids) => lowLight.push(ids) });
    mob.activate();
    expect(lowLight).toEqual([['bow', 'engine']]);
  });

  it('does not touch imaging in daylight (or when no dusk source is wired)', () => {
    const lowLight: string[][] = [];
    const daylight = setup({ isDark: () => false, applyLowLight: (ids) => lowLight.push(ids) });
    daylight.mob.activate();
    const noSource = setup({ applyLowLight: (ids) => lowLight.push(ids) });
    noSource.mob.activate();
    expect(lowLight).toEqual([]);
  });

  it('prefers a live beacon position over the dead-reckoned datum', () => {
    const beacon = { latitude: 0.01, longitude: 0.02 };
    const { mob, calls } = setup({ getBeaconTarget: () => beacon });
    const status = mob.activate();
    expect(status.targetSource).toBe('beacon');
    expect(calls.markers[0]).toEqual(beacon);
  });

  it('re-aims as own-ship moves off the datum', () => {
    let ship = { position: { latitude: 0, longitude: 0 }, headingDeg: 0 };
    const { mob, calls, tick } = setup({ getOwnShip: () => ship });
    mob.activate();
    const aimsAfterActivate = calls.aims.length;
    // Boat drifts south-west; the bearing back to the datum changes, so re-aim issues a new move.
    ship = { position: { latitude: -0.01, longitude: -0.01 }, headingDeg: 0 };
    tick();
    expect(calls.aims.length).toBeGreaterThan(aimsAfterActivate);
  });

  it('still alerts and snapshots when there is no position or beacon, but aims nothing', () => {
    const { mob, calls } = setup({ getOwnShip: () => null, getBeaconTarget: () => null });
    const status = mob.activate();
    expect(calls.raised).toHaveLength(1);
    expect(calls.snapshots).toBe(1);
    expect(calls.markers).toHaveLength(0);
    expect(calls.aims).toHaveLength(0);
    expect(status).toMatchObject({ targetSource: 'none', aimedCameras: 0 });
  });

  it('tells the crew there is NO fix and cameras were not aimed when there is no target', () => {
    const { mob, calls } = setup({ getOwnShip: () => null, getBeaconTarget: () => null });
    const status = mob.activate();
    expect(status.targetSource).toBe('none');
    expect(calls.raised[0].message).toMatch(/no position fix/i);
    expect(calls.raised[0].message).not.toMatch(/pointed at the last known position/i);
  });

  it('does not count a camera saturated at its pan limit as aimed at the target', () => {
    const tightCam: IMobCamera = {
      id: 'bow',
      hasAbsolutePtz: true,
      aimConfig: {
        mountBearingDeg: 0,
        calibration: {
          pan: { offset: 0, scalePerDeg: 0.02 },
          tilt: { offset: 0, scalePerDeg: 0.02 },
        },
      },
    };
    const beacon = { latitude: 0, longitude: 0.01 }; // due east of the datum, abeam -> pan over-ranges
    const { mob, calls } = setup({
      getOwnShip: () => ({ position: { latitude: 0, longitude: 0 }, headingDeg: 0 }),
      getBeaconTarget: () => beacon,
      getCameras: () => [tightCam],
    });
    const status = mob.activate();
    expect(calls.aims).toHaveLength(1); // the move is still dispatched (the camera's best effort)
    expect(status.aimedCameras).toBe(0); // but a clamped camera points at its limit, not the target
    expect(calls.raised[0].message).toMatch(/no PTZ camera could be aimed/i);
  });

  it('starts recording every camera on activate and stops on deactivate', () => {
    const { mob, calls } = setup();
    mob.activate();
    expect(calls.recorded).toEqual([['bow', 'engine']]); // both cameras, not just PTZ ones
    mob.deactivate();
    expect(calls.stoppedRecording).toBe(1);
  });

  it('does not move the datum when re-triggered while already active (double-press safety)', () => {
    let ship = { position: { latitude: 1, longitude: 1 }, headingDeg: 0 };
    const { mob, calls } = setup({ getOwnShip: () => ship });
    mob.activate();
    ship = { position: { latitude: 2, longitude: 2 }, headingDeg: 0 }; // boat drifts after the press
    mob.activate(); // a panicked double-press must NOT recapture the (now drifted) datum
    expect(calls.markers).toHaveLength(1);
    expect(calls.markers[0]).toEqual({ latitude: 1, longitude: 1 }); // still the original datum
  });

  it('captures the datum and drops the marker from position even without a heading', () => {
    const { mob, calls } = setup({
      getOwnShip: () => ({ position: { latitude: 5, longitude: 6 } }), // no headingDeg
    });
    const status = mob.activate();
    expect(calls.markers).toEqual([{ latitude: 5, longitude: 6 }]);
    expect(status.targetSource).toBe('datum');
    expect(calls.aims).toHaveLength(0); // can't aim without a heading, but the datum/marker survive
  });

  it('ignores a distress beacon implausibly far from the datum (another vessel’s SART)', () => {
    const farBeacon = { latitude: 10, longitude: 10 }; // ~1500 km from the datum origin
    const { mob, calls } = setup({ getBeaconTarget: () => farBeacon });
    const status = mob.activate();
    expect(status.targetSource).toBe('datum'); // not hijacked to the unrelated beacon
    expect(calls.markers[0]).toEqual({ latitude: 0, longitude: 0 });
  });

  it('uses a distress beacon as the target when there is no datum (best available)', () => {
    const beacon = { latitude: 10, longitude: 10 };
    const { mob, calls } = setup({ getOwnShip: () => null, getBeaconTarget: () => beacon });
    const status = mob.activate();
    expect(status.targetSource).toBe('beacon');
    expect(calls.markers[0]).toEqual(beacon);
  });

  it('does not let a re-aim throw escape the timer (no uncaughtException during an active MOB)', () => {
    const logs: string[] = [];
    let boom = false;
    const { mob, tick } = setup({
      getCameras: () => {
        if (boom) throw new Error('boom');
        return [ptzCam('bow')];
      },
      log: (m) => logs.push(m),
    });
    mob.activate();
    boom = true;
    expect(() => tick()).not.toThrow();
    expect(logs.some((l) => /re-?aim/i.test(l))).toBe(true);
  });

  it('deactivate clears the notification and stops re-aiming', () => {
    const { mob, calls, tick } = setup();
    mob.activate();
    mob.deactivate();
    expect(calls.cleared).toBe(1);
    expect(calls.clearedInterval).toBe(1);
    expect(mob.isActive()).toBe(false);
    const before = calls.aims.length;
    tick(); // a stray timer firing after deactivate must not re-aim
    expect(calls.aims.length).toBe(before);
  });
});
