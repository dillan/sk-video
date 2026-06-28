import { describe, it, expect } from 'vitest';
import { solveAxis, degToNormalized, calibrationFromSamples } from './fov-calibration';

describe('solveAxis', () => {
  it('solves slope and offset from two samples through the origin', () => {
    expect(solveAxis({ deg: 0, normalized: 0 }, { deg: 100, normalized: 1 })).toEqual({
      offset: 0,
      scalePerDeg: 0.01,
    });
  });

  it('solves slope and offset from two samples with a non-zero intercept', () => {
    const axis = solveAxis({ deg: 10, normalized: 0.2 }, { deg: 20, normalized: 0.4 });
    expect(axis.scalePerDeg).toBeCloseTo(0.02, 10);
    expect(axis.offset).toBeCloseTo(0, 10);
    expect(degToNormalized(15, axis)).toBeCloseTo(0.3, 10);
  });

  it('throws when the two samples share the same angle', () => {
    expect(() => solveAxis({ deg: 30, normalized: 0.1 }, { deg: 30, normalized: 0.5 })).toThrow();
  });
});

describe('calibrationFromSamples', () => {
  const valid = {
    pan: [
      { deg: -30, normalized: -0.5 },
      { deg: 30, normalized: 0.5 },
    ],
    tilt: [
      { deg: -10, normalized: -0.2 },
      { deg: 10, normalized: 0.2 },
    ],
  };

  it('solves both axes from a two-point-per-axis capture', () => {
    expect(calibrationFromSamples(valid)).toEqual({
      pan: { offset: 0, scalePerDeg: 1 / 60 },
      tilt: { offset: 0, scalePerDeg: 0.02 },
    });
  });

  it('returns null when an axis is missing', () => {
    expect(calibrationFromSamples({ pan: valid.pan })).toBeNull();
  });

  it('returns null when an axis does not have exactly two samples', () => {
    expect(calibrationFromSamples({ ...valid, pan: [valid.pan[0]] })).toBeNull();
  });

  it('returns null for a non-finite or out-of-range normalised value', () => {
    expect(
      calibrationFromSamples({
        ...valid,
        pan: [
          { deg: -30, normalized: -0.5 },
          { deg: 30, normalized: 1.5 }, // outside [-1, 1]
        ],
      }),
    ).toBeNull();
    expect(
      calibrationFromSamples({
        ...valid,
        pan: [
          { deg: -30, normalized: Number.NaN },
          { deg: 30, normalized: 0.5 },
        ],
      }),
    ).toBeNull();
  });

  it('returns null when both samples on an axis use the same angle', () => {
    expect(
      calibrationFromSamples({
        ...valid,
        pan: [
          { deg: 30, normalized: 0.1 },
          { deg: 30, normalized: 0.5 },
        ],
      }),
    ).toBeNull();
  });

  it('returns null for a non-object input', () => {
    expect(calibrationFromSamples(null)).toBeNull();
    expect(calibrationFromSamples('nope')).toBeNull();
  });
});

describe('degToNormalized', () => {
  const axis = { offset: 0, scalePerDeg: 0.01 };

  it('applies the linear map', () => {
    expect(degToNormalized(50, axis)).toBeCloseTo(0.5, 10);
    expect(degToNormalized(-50, axis)).toBeCloseTo(-0.5, 10);
  });

  it('clamps to the ONVIF [-1, 1] range', () => {
    expect(degToNormalized(1000, axis)).toBe(1);
    expect(degToNormalized(-1000, axis)).toBe(-1);
  });
});
