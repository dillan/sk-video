import { describe, it, expect } from 'vitest';
import { planSlew, type ISlewOwnShip } from './slew-to-cue';
import type { IAisTarget } from './ais-targets';
import type { ICameraAimConfig, ILatLon } from '../safety/mob-geo';

const EARTH_RADIUS_M = 6_371_000;
const D2R = Math.PI / 180;
const ORIGIN: ILatLon = { latitude: 0, longitude: 0 };
const at = (eastM: number, northM: number): ILatLon => ({
  latitude: northM / (EARTH_RADIUS_M * D2R),
  longitude: eastM / (EARTH_RADIUS_M * D2R),
});

const CAL = { pan: { offset: 0, scalePerDeg: 0.01 }, tilt: { offset: 0, scalePerDeg: 0.01 } };
const calibrated: ICameraAimConfig = { mountBearingDeg: 0, calibration: CAL };
const uncalibrated: ICameraAimConfig = { mountBearingDeg: 0 };

// Own-ship at origin, pointed north, stationary.
const own: ISlewOwnShip = { position: ORIGIN, headingDeg: 0, sogMps: 0, cogDeg: 0 };

const target = (id: string, pos: ILatLon, sogMps = 4, cogDeg = 180): IAisTarget => ({
  id,
  position: pos,
  sogMps,
  cogDeg,
});

describe('planSlew', () => {
  it('aims at the nearest-CPA target and returns its aim + cpa', () => {
    const targets = [
      target('east-threat', at(1000, 1000)), // due NE-ish, closing
      target('far', at(8000, 1000)),
    ];
    const plan = planSlew(own, targets, calibrated);
    expect(plan).not.toBeNull();
    expect(plan!.target.id).toBe('east-threat');
    // Target is to the east of a north-pointing boat -> positive pan.
    expect(plan!.aim.pan).toBeGreaterThan(0);
    expect(plan!.aim.tilt).toBe(0); // waterline elevation
    expect(plan!.cpa.cpaMeters).toBeGreaterThanOrEqual(0);
  });

  it('returns null for an uncalibrated camera (cannot geo-point)', () => {
    expect(planSlew(own, [target('t', at(500, 500))], uncalibrated)).toBeNull();
  });

  it('returns null when no target qualifies', () => {
    const leaving = target('leaving', at(0, 200), 9, 0); // heading away
    expect(planSlew(own, [leaving], calibrated)).toBeNull();
    expect(planSlew(own, [], calibrated)).toBeNull();
  });
});
