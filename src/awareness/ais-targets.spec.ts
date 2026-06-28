import { describe, it, expect } from 'vitest';
import { parseAisTargets, nearestCpaTarget } from './ais-targets';
import type { IKinematics } from './cpa';
import type { ILatLon } from '../safety/mob-geo';

const EARTH_RADIUS_M = 6_371_000;
const D2R = Math.PI / 180;
const ORIGIN: ILatLon = { latitude: 0, longitude: 0 };
const at = (eastM: number, northM: number): ILatLon => ({
  latitude: northM / (EARTH_RADIUS_M * D2R),
  longitude: eastM / (EARTH_RADIUS_M * D2R),
});

function vessel(lat: number, lon: number, sog?: number, cogRad?: number, extra: object = {}) {
  return {
    navigation: {
      position: { value: { latitude: lat, longitude: lon } },
      ...(sog !== undefined ? { speedOverGround: { value: sog } } : {}),
      ...(cogRad !== undefined ? { courseOverGroundTrue: { value: cogRad } } : {}),
    },
    ...extra,
  };
}

describe('parseAisTargets', () => {
  it('extracts positioned vessels with sog/cog, skipping self, beacons, and position-less entries', () => {
    const vessels = {
      'urn:mrn:imo:mmsi:111111111': vessel(1, 2, 5, Math.PI, { name: 'Cargo One' }),
      'urn:mrn:imo:mmsi:974111111': vessel(1, 2), // an AIS-MOB beacon — excluded
      'urn:mrn:imo:mmsi:222222222': { navigation: {} }, // no position — excluded
      self: vessel(0, 0),
    };
    const targets = parseAisTargets(vessels, 'self');
    expect(targets.map((t) => t.id)).toEqual(['urn:mrn:imo:mmsi:111111111']);
    expect(targets[0]).toMatchObject({ mmsi: '111111111', name: 'Cargo One', sogMps: 5 });
    expect(targets[0].cogDeg).toBeCloseTo(180, 5); // PI rad -> 180 deg
  });

  it('defaults missing sog/cog to 0 and returns [] for junk input', () => {
    const targets = parseAisTargets({ 'urn:mrn:imo:mmsi:333333333': vessel(0.1, 0.1) });
    expect(targets[0]).toMatchObject({ sogMps: 0, cogDeg: 0 });
    expect(parseAisTargets(null)).toEqual([]);
    expect(parseAisTargets('nope')).toEqual([]);
  });
});

describe('nearestCpaTarget', () => {
  const own: IKinematics = { position: ORIGIN, sogMps: 0, cogDeg: 0 };

  it('picks the smallest-CPA approaching target and ignores a separating one', () => {
    const targets = [
      { id: 'far-pass', position: at(2000, 1000), sogMps: 4, cogDeg: 180 }, // passes ~2000 m abeam
      { id: 'close-pass', position: at(200, 1000), sogMps: 4, cogDeg: 180 }, // passes ~200 m abeam
      { id: 'leaving', position: at(0, 300), sogMps: 6, cogDeg: 0 }, // heading away (tcpa < 0)
    ];
    const best = nearestCpaTarget(own, targets);
    expect(best?.target.id).toBe('close-pass');
    expect(best?.cpa.cpaMeters).toBeCloseTo(200, -1);
  });

  it('returns null when every target is out of range or already separating', () => {
    const targets = [
      { id: 'too-far', position: at(0, 999_999), sogMps: 4, cogDeg: 180 },
      { id: 'leaving', position: at(0, 100), sogMps: 9, cogDeg: 0 },
    ];
    expect(nearestCpaTarget(own, targets, { maxRangeMeters: 5000 })).toBeNull();
  });
});
