import { describe, it, expect } from 'vitest';
import { solarAltitudeDeg, isAfterDusk } from './dusk';

// Reference cases use generous bounds so the low-precision solar model's ~1° error never flakes.
describe('solarAltitudeDeg', () => {
  it('puts the sun near the zenith at the equator at local solar noon on the equinox', () => {
    const alt = solarAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, 0);
    expect(alt).toBeGreaterThan(80);
  });

  it('puts the sun near the nadir at the equator at local midnight on the equinox', () => {
    const alt = solarAltitudeDeg(new Date('2026-03-20T00:00:00Z'), 0, 0);
    expect(alt).toBeLessThan(-80);
  });

  it('matches the known midday solar altitude at a mid-latitude on the summer solstice', () => {
    // Greenwich (51.48N, 0E), summer solstice noon: ~62 degrees above the horizon.
    const alt = solarAltitudeDeg(new Date('2026-06-21T12:00:00Z'), 51.48, 0);
    expect(alt).toBeGreaterThan(55);
    expect(alt).toBeLessThan(68);
  });

  it('keeps the sun below the horizon at the same place at solar midnight', () => {
    const alt = solarAltitudeDeg(new Date('2026-06-21T00:00:00Z'), 51.48, 0);
    expect(alt).toBeLessThan(-5);
  });
});

describe('isAfterDusk', () => {
  it('is false in broad daylight and true after the sun is down', () => {
    expect(isAfterDusk(new Date('2026-03-20T12:00:00Z'), 0, 0)).toBe(false);
    expect(isAfterDusk(new Date('2026-03-20T00:00:00Z'), 0, 0)).toBe(true);
  });

  it('honours a custom altitude threshold (civil twilight)', () => {
    // A moment when the sun is a few degrees below the horizon: past sunset (0) but before civil
    // dusk (-6). So the default (0) treats it as dusk, while a -6 threshold does not yet.
    const date = new Date('2026-06-21T20:35:00Z');
    const alt = solarAltitudeDeg(date, 51.48, 0);
    expect(alt).toBeLessThan(0);
    expect(alt).toBeGreaterThan(-6);
    expect(isAfterDusk(date, 51.48, 0)).toBe(true);
    expect(isAfterDusk(date, 51.48, 0, -6)).toBe(false);
  });
});
