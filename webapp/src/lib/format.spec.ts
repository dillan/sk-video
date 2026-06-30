import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  radToDeg,
  mpsToKnots,
  degMin,
  formatLatLon,
  formatBearing,
  parseVesselState,
} from './format';

describe('unit conversions', () => {
  it('converts radians to degrees and m/s to knots', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(mpsToKnots(1)).toBeCloseTo(1.943844, 4);
  });
});

describe('degMin / formatLatLon', () => {
  it('formats degrees-decimal-minutes with the right hemisphere and padding', () => {
    expect(degMin(41.3766, 'lat')).toBe('41°22.6′N');
    expect(degMin(-70.7516, 'lon')).toBe('070°45.1′W');
    expect(degMin(-1.5, 'lat')).toBe('01°30.0′S');
  });
  it('joins lat and lon', () => {
    expect(formatLatLon(41.3766, -70.7516)).toBe('41°22.6′N  070°45.1′W');
  });
});

describe('formatBearing', () => {
  it('zero-pads and normalizes to 0–359', () => {
    expect(formatBearing(14)).toBe('014°');
    expect(formatBearing(0)).toBe('000°');
    expect(formatBearing(360)).toBe('000°');
    expect(formatBearing(-10)).toBe('350°');
  });
});

describe('parseVesselState', () => {
  it('parses a full Signal K self tree into helm units', () => {
    const v = parseVesselState({
      navigation: {
        position: { value: { latitude: 41.3766, longitude: -70.7516 } },
        headingTrue: { value: Math.PI / 2 }, // 90°
        speedOverGround: { value: 1 }, // ~1.94 kn
      },
    });
    expect(v.hasFix).toBe(true);
    expect(v.lat).toBeCloseTo(41.3766);
    expect(v.headingDeg).toBeCloseTo(90);
    expect(v.sogKn).toBeCloseTo(1.943844, 3);
  });

  it('reports no fix when position is missing or non-finite', () => {
    expect(parseVesselState({}).hasFix).toBe(false);
    expect(parseVesselState({ navigation: { position: { value: null } } }).hasFix).toBe(false);
    expect(
      parseVesselState({ navigation: { position: { value: { latitude: 'x', longitude: 1 } } } })
        .hasFix,
    ).toBe(false);
  });

  it('falls back to magnetic heading when true heading is absent', () => {
    const v = parseVesselState({ navigation: { headingMagnetic: { value: Math.PI } } });
    expect(v.headingDeg).toBeCloseTo(180);
  });
});

describe('formatBytes', () => {
  it('formats byte sizes with sensible units and precision', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5_000_000)).toBe('4.8 MB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB'); // ≥10 drops the decimal
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
  it('handles a bad size honestly', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});
