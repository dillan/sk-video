import { describe, it, expect } from 'vitest';
import { slewOwnShipFromSelfState, slewCameraAimConfig } from './slew-wiring';
import type { ISelfState, ISelfReading } from '../signalk/sk-bridge';
import type { ICamera } from '../cameras/camera-validation';

const reading = <T>(value: T | null): ISelfReading<T> => ({ value });
function selfState(over: Partial<ISelfState> = {}): ISelfState {
  return {
    position: reading({ latitude: 47.6, longitude: -122.3 }),
    headingTrue: reading(Math.PI / 2), // 90 deg
    speedOverGround: reading(3),
    courseOverGroundTrue: reading(Math.PI), // 180 deg
    depth: reading(null),
    wind: { speedApparent: reading(null), angleApparent: reading(null) },
    ...over,
  };
}

describe('slewOwnShipFromSelfState', () => {
  it('uses true heading as the reference and COG/SOG for the motion vector (radians -> degrees)', () => {
    const own = slewOwnShipFromSelfState(selfState());
    expect(own).toMatchObject({ headingDeg: 90, sogMps: 3, cogDeg: 180 });
    expect(own!.position).toEqual({ latitude: 47.6, longitude: -122.3 });
  });

  it('falls back to COG as the aiming reference when heading is absent', () => {
    const own = slewOwnShipFromSelfState(selfState({ headingTrue: reading(null) }));
    expect(own?.headingDeg).toBe(180); // COG used for the reference
  });

  it('returns null without a position, or without any heading/course reference', () => {
    expect(slewOwnShipFromSelfState(selfState({ position: reading(null) }))).toBeNull();
    expect(
      slewOwnShipFromSelfState(
        selfState({ headingTrue: reading(null), courseOverGroundTrue: reading(null) }),
      ),
    ).toBeNull();
  });

  it('defaults SOG to 0 when absent', () => {
    expect(slewOwnShipFromSelfState(selfState({ speedOverGround: reading(null) }))?.sogMps).toBe(0);
  });
});

describe('slewCameraAimConfig', () => {
  it('maps capability + placement + calibration into an aim config', () => {
    const camera = {
      name: 'Mast',
      enabled: true,
      source: { scheme: 'rtsp', host: 'cam' },
      capabilities: { absolutePtz: true },
      placement: { bearingRelativeDeg: 30 },
      calibration: {
        pan: { offset: 0, scalePerDeg: 0.01 },
        tilt: { offset: 0, scalePerDeg: 0.01 },
      },
    } as unknown as ICamera;
    expect(slewCameraAimConfig(camera)).toEqual({
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

  it('reports no absolute PTZ when the capability is absent', () => {
    const camera = {
      name: 'Fixed',
      enabled: true,
      source: { scheme: 'rtsp', host: 'c' },
    } as ICamera;
    expect(slewCameraAimConfig(camera).hasAbsolutePtz).toBe(false);
  });
});
