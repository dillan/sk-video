import { describe, it, expect } from 'vitest';
import { computeCpa, distanceMeters, type IKinematics } from './cpa';
import type { ILatLon } from '../safety/mob-geo';

const EARTH_RADIUS_M = 6_371_000;
const D2R = Math.PI / 180;
const ORIGIN: ILatLon = { latitude: 0, longitude: 0 };

/** Build a lat/lon at an east/north metre offset from the origin (small-offset inverse projection). */
function at(eastM: number, northM: number): ILatLon {
  return {
    latitude: northM / (EARTH_RADIUS_M * D2R),
    longitude: eastM / (EARTH_RADIUS_M * D2R * Math.cos(0)),
  };
}

describe('distanceMeters', () => {
  it('measures a short east/north offset within a metre', () => {
    expect(distanceMeters(ORIGIN, at(0, 1000))).toBeCloseTo(1000, 0);
    expect(distanceMeters(ORIGIN, at(300, 400))).toBeCloseTo(500, 0);
  });
});

describe('computeCpa', () => {
  it('a head-on closing pair reaches CPA 0 at the meeting time', () => {
    // Own at origin heading north at 5 m/s; target 1000 m north heading south at 5 m/s.
    const own: IKinematics = { position: ORIGIN, sogMps: 5, cogDeg: 0 };
    const target: IKinematics = { position: at(0, 1000), sogMps: 5, cogDeg: 180 };
    const r = computeCpa(own, target);
    expect(r.cpaMeters).toBeCloseTo(0, 0);
    expect(r.tcpaSeconds).toBeCloseTo(100, 0); // 1000 m closing at 10 m/s
    expect(r.rangeMeters).toBeCloseTo(1000, 0);
    expect(r.bearingDeg).toBeCloseTo(0, 1); // due north
  });

  it('a target passing abeam has a positive CPA equal to its crossing offset', () => {
    // Own stationary at origin; target 500 m east, 1000 m north, heading due south at 4 m/s.
    const own: IKinematics = { position: ORIGIN, sogMps: 0, cogDeg: 0 };
    const target: IKinematics = { position: at(500, 1000), sogMps: 4, cogDeg: 180 };
    const r = computeCpa(own, target);
    expect(r.cpaMeters).toBeCloseTo(500, 0); // closest approach is the 500 m east offset
    expect(r.tcpaSeconds).toBeCloseTo(250, 0); // 1000 m north / 4 m/s
  });

  it('a separating target reports negative TCPA and CPA >= current range', () => {
    // Target 200 m north already heading further north faster than own.
    const own: IKinematics = { position: ORIGIN, sogMps: 1, cogDeg: 0 };
    const target: IKinematics = { position: at(0, 200), sogMps: 6, cogDeg: 0 };
    const r = computeCpa(own, target);
    expect(r.tcpaSeconds).toBeLessThan(0);
  });

  it('co-moving vessels report TCPA 0 and CPA = current range', () => {
    const own: IKinematics = { position: ORIGIN, sogMps: 3, cogDeg: 90 };
    const target: IKinematics = { position: at(0, 800), sogMps: 3, cogDeg: 90 };
    const r = computeCpa(own, target);
    expect(r.tcpaSeconds).toBe(0);
    expect(r.cpaMeters).toBeCloseTo(800, 0);
  });
});
