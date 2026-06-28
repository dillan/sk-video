import { describe, it, expect } from 'vitest';
import { toMobCamera, ownShipFromSelfState, findMobBeacon } from './mob-wiring';
import type { ICamera } from '../cameras/camera-validation';
import type { ISelfState } from '../signalk/sk-bridge';

const reading = <T>(value: T | null) => ({ value });
function selfState(over: Partial<Record<string, unknown>> = {}): ISelfState {
  return {
    position: reading<{ latitude: number; longitude: number }>(null),
    headingTrue: reading<number>(null),
    speedOverGround: reading<number>(null),
    courseOverGroundTrue: reading<number>(null),
    depth: reading<number>(null),
    wind: { speedApparent: reading<number>(null), angleApparent: reading<number>(null) },
    ...over,
  } as ISelfState;
}

describe('toMobCamera', () => {
  it('maps capabilities + placement + calibration into an aim config', () => {
    const camera = {
      name: 'Bow',
      enabled: true,
      source: { scheme: 'onvif', host: 'cam' },
      capabilities: { absolutePtz: true },
      placement: { bearingRelativeDeg: 30 },
      calibration: {
        pan: { offset: 0, scalePerDeg: 0.01 },
        tilt: { offset: 0, scalePerDeg: 0.01 },
      },
    } as ICamera;
    expect(toMobCamera('bow', camera)).toEqual({
      id: 'bow',
      hasAbsolutePtz: true,
      aimConfig: {
        mountBearingDeg: 30,
        calibration: {
          pan: { offset: 0, scalePerDeg: 0.01 },
          tilt: { offset: 0, scalePerDeg: 0.01 },
        },
      },
    });
  });

  it('marks a camera without absolute PTZ as not aimable', () => {
    const camera = { name: 'c', enabled: true, source: { scheme: 'rtsp', host: 'c' } } as ICamera;
    expect(toMobCamera('c', camera).hasAbsolutePtz).toBe(false);
  });
});

describe('ownShipFromSelfState', () => {
  it('builds own-ship state and converts the heading from radians to degrees', () => {
    const self = selfState({
      position: reading({ latitude: 47.6, longitude: -122.3 }),
      headingTrue: reading(Math.PI / 2),
    });
    const ship = ownShipFromSelfState(self);
    expect(ship?.position).toEqual({ latitude: 47.6, longitude: -122.3 });
    expect(ship?.headingDeg).toBeCloseTo(90, 5);
  });

  it('captures position even when heading is missing, so the MOB datum/marker is never lost', () => {
    const ship = ownShipFromSelfState(
      selfState({ position: reading({ latitude: 1, longitude: 2 }) }),
    );
    expect(ship?.position).toEqual({ latitude: 1, longitude: 2 });
    expect(ship?.headingDeg).toBeUndefined(); // no heading -> can't aim, but the datum survives
  });

  it('uses COG as a heading proxy when making way without a true heading', () => {
    const ship = ownShipFromSelfState(
      selfState({
        position: reading({ latitude: 1, longitude: 2 }),
        courseOverGroundTrue: reading(Math.PI), // 180°
        speedOverGround: reading(2), // > 0.5 m/s: making way, so course is a usable heading proxy
      }),
    );
    expect(ship?.headingDeg).toBeCloseTo(180, 5);
  });

  it('does not treat COG as heading when barely moving (course is noise at rest)', () => {
    const ship = ownShipFromSelfState(
      selfState({
        position: reading({ latitude: 1, longitude: 2 }),
        courseOverGroundTrue: reading(Math.PI),
        speedOverGround: reading(0.2), // < 0.5 m/s
      }),
    );
    expect(ship?.position).toBeDefined();
    expect(ship?.headingDeg).toBeUndefined();
  });

  it('returns null only when there is no position', () => {
    expect(ownShipFromSelfState(selfState())).toBeNull();
  });
});

describe('findMobBeacon', () => {
  const vessel = (mmsi: string, lat: number, lon: number) => ({
    mmsi,
    navigation: { position: { value: { latitude: lat, longitude: lon } } },
  });

  it('finds an AIS-MOB (974) / SART (972) beacon position', () => {
    const vessels = {
      'urn:mrn:imo:mmsi:366123456': vessel('366123456', 1, 1), // a normal vessel
      'urn:mrn:imo:mmsi:974123456': vessel('974123456', 47.6, -122.3), // AIS-MOB
    };
    expect(findMobBeacon(vessels)).toEqual({ latitude: 47.6, longitude: -122.3 });
  });

  it('falls back to the MMSI in the context key when no mmsi field is present', () => {
    const vessels = {
      'urn:mrn:imo:mmsi:972000111': {
        navigation: { position: { value: { latitude: 10, longitude: 20 } } },
      },
    };
    expect(findMobBeacon(vessels)).toEqual({ latitude: 10, longitude: 20 });
  });

  it('returns null when there is no beacon (and tolerates junk)', () => {
    expect(findMobBeacon({ 'urn:mrn:imo:mmsi:366123456': vessel('366123456', 1, 1) })).toBeNull();
    expect(findMobBeacon(null)).toBeNull();
    expect(findMobBeacon({ x: { mmsi: '974999999' } })).toBeNull(); // beacon but no position
  });
});
