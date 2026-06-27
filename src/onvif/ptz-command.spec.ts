import { describe, it, expect } from 'vitest';
import { clampPtzVelocity, clampPtzPosition, isValidPtzToken } from './ptz-command';

describe('clampPtzVelocity', () => {
  it('passes through in-range values', () => {
    expect(clampPtzVelocity({ pan: 0.5, tilt: -0.25, zoom: 1 })).toEqual({
      pan: 0.5,
      tilt: -0.25,
      zoom: 1,
    });
  });

  it('clamps out-of-range values to [-1, 1]', () => {
    expect(clampPtzVelocity({ pan: 5, tilt: -9, zoom: 2 })).toEqual({ pan: 1, tilt: -1, zoom: 1 });
  });

  it('coerces missing or non-finite values to 0', () => {
    expect(clampPtzVelocity({ pan: 0.3 })).toEqual({ pan: 0.3, tilt: 0, zoom: 0 });
    expect(clampPtzVelocity({ pan: NaN, tilt: Infinity, zoom: undefined })).toEqual({
      pan: 0,
      tilt: 0,
      zoom: 0,
    });
    expect(clampPtzVelocity(null)).toEqual({ pan: 0, tilt: 0, zoom: 0 });
  });
});

describe('clampPtzPosition', () => {
  it('passes through in-range values (zoom is one-sided 0..1)', () => {
    expect(clampPtzPosition({ pan: -0.5, tilt: 0.25, zoom: 0.7 })).toEqual({
      pan: -0.5,
      tilt: 0.25,
      zoom: 0.7,
    });
  });

  it('clamps pan/tilt to [-1,1] and zoom to [0,1]', () => {
    expect(clampPtzPosition({ pan: 5, tilt: -9, zoom: 2 })).toEqual({ pan: 1, tilt: -1, zoom: 1 });
    expect(clampPtzPosition({ pan: 0, tilt: 0, zoom: -3 })).toEqual({ pan: 0, tilt: 0, zoom: 0 });
  });

  it('coerces missing or non-finite values to 0', () => {
    expect(clampPtzPosition({ tilt: 0.4 })).toEqual({ pan: 0, tilt: 0.4, zoom: 0 });
    expect(clampPtzPosition(null)).toEqual({ pan: 0, tilt: 0, zoom: 0 });
  });
});

describe('isValidPtzToken', () => {
  it('accepts short plain identifiers', () => {
    expect(isValidPtzToken('Preset1')).toBe(true);
    expect(isValidPtzToken('profile_token-2')).toBe(true);
  });

  it('rejects empty, overlong, or injection-prone tokens', () => {
    expect(isValidPtzToken('')).toBe(false);
    expect(isValidPtzToken('a'.repeat(65))).toBe(false);
    expect(isValidPtzToken('<inject>')).toBe(false);
    expect(isValidPtzToken('a b')).toBe(false);
    expect(isValidPtzToken("a'or'1")).toBe(false);
    expect(isValidPtzToken(42)).toBe(false);
    expect(isValidPtzToken(null)).toBe(false);
  });
});
