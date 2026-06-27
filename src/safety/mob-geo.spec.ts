import { describe, it, expect } from 'vitest';
import { bearingTo, relativeBearing, computeAim, type ICameraAimConfig } from './mob-geo';

const at = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('bearingTo', () => {
  it('points north / east / south / west for the cardinal directions', () => {
    const origin = at(0, 0);
    expect(bearingTo(origin, at(1, 0))).toBeCloseTo(0, 1); // due north
    expect(bearingTo(origin, at(0, 1))).toBeCloseTo(90, 1); // due east
    expect(bearingTo(origin, at(-1, 0))).toBeCloseTo(180, 1); // due south
    expect(bearingTo(origin, at(0, -1))).toBeCloseTo(270, 1); // due west
  });

  it('returns a value in [0, 360)', () => {
    const b = bearingTo(at(47.6, -122.3), at(47.5, -122.4));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe('relativeBearing', () => {
  it('returns a signed offset normalised to (-180, 180]', () => {
    expect(relativeBearing(10, 0)).toBeCloseTo(10);
    expect(relativeBearing(350, 0)).toBeCloseTo(-10);
    expect(relativeBearing(90, 270)).toBeCloseTo(180);
    expect(relativeBearing(0, 90)).toBeCloseTo(-90);
  });
});

describe('computeAim', () => {
  const cal: ICameraAimConfig = {
    mountBearingDeg: 0, // camera points forward
    calibration: { pan: { offset: 0, scalePerDeg: 0.01 }, tilt: { offset: 0, scalePerDeg: 0.01 } },
  };

  it('aims a forward camera at a target off the bow', () => {
    // Heading north, target due east → 90° to starboard → pan = 0.01 * 90 = 0.9.
    const aim = computeAim({ position: at(0, 0), headingDeg: 0 }, at(0, 1), cal);
    expect(aim?.pan).toBeCloseTo(0.9, 2);
  });

  it('accounts for the camera mount bearing (a starboard camera sees an east target dead-centre)', () => {
    const starboard: ICameraAimConfig = { ...cal, mountBearingDeg: 90 };
    const aim = computeAim({ position: at(0, 0), headingDeg: 0 }, at(0, 1), starboard);
    expect(aim?.pan).toBeCloseTo(0, 2);
  });

  it('accounts for own-ship heading (target dead ahead when heading toward it)', () => {
    // Heading east toward an east target → target is dead ahead → pan 0 for a forward camera.
    const aim = computeAim({ position: at(0, 0), headingDeg: 90 }, at(0, 1), cal);
    expect(aim?.pan).toBeCloseTo(0, 2);
  });

  it('clamps pan to the ONVIF range for a target hard abeam', () => {
    // Target due west while heading north → 90° to port, but a tighter calibration over-ranges.
    const tight: ICameraAimConfig = {
      mountBearingDeg: 0,
      calibration: {
        pan: { offset: 0, scalePerDeg: 0.02 },
        tilt: { offset: 0, scalePerDeg: 0.02 },
      },
    };
    const aim = computeAim({ position: at(0, 0), headingDeg: 0 }, at(0, -1), tight);
    expect(aim?.pan).toBe(-1); // -90° * 0.02 = -1.8, clamped
  });

  it('returns null when the camera has no calibration (cannot be geo-pointed)', () => {
    expect(
      computeAim({ position: at(0, 0), headingDeg: 0 }, at(0, 1), { mountBearingDeg: 0 }),
    ).toBeNull();
  });
});
