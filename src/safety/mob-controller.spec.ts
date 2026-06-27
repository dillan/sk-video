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

  it('starts recording every camera on activate and stops on deactivate', () => {
    const { mob, calls } = setup();
    mob.activate();
    expect(calls.recorded).toEqual([['bow', 'engine']]); // both cameras, not just PTZ ones
    mob.deactivate();
    expect(calls.stoppedRecording).toBe(1);
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
