/**
 * Pure formatting for the telemetry strip. Signal K reports SI units (heading in radians, speed in
 * m/s, position in decimal degrees); the helm reads degrees, knots, and degrees-decimal-minutes. These
 * are honest about missing data: no position → no fix, and we never invent a heading or speed.
 */

export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;
export const mpsToKnots = (mps: number): number => mps * 1.943844;

/** Format a decimal degree as D°MM.m′ with a hemisphere letter (no fabricated precision). */
export function degMin(value: number, axis: 'lat' | 'lon'): string {
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const pad = axis === 'lat' ? 2 : 3;
  return `${String(deg).padStart(pad, '0')}°${min.toFixed(1).padStart(4, '0')}′${hemi}`;
}

export function formatLatLon(lat: number, lon: number): string {
  return `${degMin(lat, 'lat')}  ${degMin(lon, 'lon')}`;
}

/** Heading in degrees as a zero-padded bearing, e.g. 14 → "014°". */
export function formatBearing(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  return `${String(Math.round(norm)).padStart(3, '0')}°`;
}

export interface IVesselState {
  hasFix: boolean;
  lat?: number;
  lon?: number;
  headingDeg?: number;
  sogKn?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Parse the Signal K `vessels/self` tree (loosely — servers vary) into the few values the strip shows.
 * Reads true heading, falling back to magnetic. A missing/!finite position is reported as "no fix".
 */
export function parseVesselState(raw: unknown): IVesselState {
  const nav = (raw as { navigation?: Record<string, { value?: unknown }> })?.navigation ?? {};
  const pos = (nav.position?.value ?? null) as { latitude?: unknown; longitude?: unknown } | null;
  const lat = num(pos?.latitude);
  const lon = num(pos?.longitude);
  const headingRad = num(nav.headingTrue?.value) ?? num(nav.headingMagnetic?.value);
  const sogMps = num(nav.speedOverGround?.value);
  return {
    hasFix: lat !== undefined && lon !== undefined,
    lat,
    lon,
    headingDeg: headingRad !== undefined ? radToDeg(headingRad) : undefined,
    sogKn: sogMps !== undefined ? mpsToKnots(sogMps) : undefined,
  };
}
