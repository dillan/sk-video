import { describe, it, expect } from 'vitest';
import { solveAxis, degToNormalized } from './fov-calibration';

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
