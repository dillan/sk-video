/**
 * Per-camera field-of-view calibration maths. ONVIF `absoluteMove` takes NORMALISED pan/tilt in
 * [-1, 1], not degrees, so geo-pointing (aim a PTZ at a bearing/elevation) needs a per-camera linear
 * map from degrees to normalised units. A short two-point wizard captures two (degrees, normalised)
 * samples per axis; `solveAxis` turns them into a linear coefficient pair, and `degToNormalized`
 * applies it (clamped to the ONVIF range). This module is pure maths with no ONVIF/camera coupling.
 */

export interface ICalibrationAxis {
  /** Normalised value at 0 degrees. */
  offset: number;
  /** Normalised units per degree. */
  scalePerDeg: number;
}

export interface ICalibrationSample {
  deg: number;
  normalized: number;
}

/** Solve a linear axis calibration from two distinct-angle samples. */
export function solveAxis(a: ICalibrationSample, b: ICalibrationSample): ICalibrationAxis {
  if (a.deg === b.deg) {
    throw new Error('calibration samples must use two different angles');
  }
  const scalePerDeg = (b.normalized - a.normalized) / (b.deg - a.deg);
  const offset = a.normalized - scalePerDeg * a.deg;
  return { offset, scalePerDeg };
}

/** A full per-camera calibration: a linear map for each of the pan and tilt axes. */
export interface ICameraCalibration {
  pan: ICalibrationAxis;
  tilt: ICalibrationAxis;
}

/**
 * Build a full calibration from a (raw, untrusted) two-point-per-axis capture, or null if the samples
 * are malformed. Each axis needs exactly two samples with finite `deg` and a `normalized` in the ONVIF
 * [-1, 1] range, at two DIFFERENT angles (a single point can't define a line). This is the server-side
 * solve behind the one-time calibration wizard — the route validates with it before persisting.
 */
export function calibrationFromSamples(input: unknown): ICameraCalibration | null {
  const o = input as { pan?: unknown; tilt?: unknown };
  const pan = parseAxisSamples(o?.pan);
  const tilt = parseAxisSamples(o?.tilt);
  if (!pan || !tilt) {
    return null;
  }
  try {
    return { pan: solveAxis(pan[0], pan[1]), tilt: solveAxis(tilt[0], tilt[1]) };
  } catch {
    return null; // both samples on an axis used the same angle
  }
}

function parseAxisSamples(value: unknown): [ICalibrationSample, ICalibrationSample] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const a = parseSample(value[0]);
  const b = parseSample(value[1]);
  return a && b ? [a, b] : null;
}

function parseSample(value: unknown): ICalibrationSample | null {
  const s = value as { deg?: unknown; normalized?: unknown };
  if (typeof s?.deg !== 'number' || !Number.isFinite(s.deg)) {
    return null;
  }
  if (typeof s?.normalized !== 'number' || !Number.isFinite(s.normalized)) {
    return null;
  }
  if (s.normalized < -1 || s.normalized > 1) {
    return null; // outside the normalised ONVIF range
  }
  return { deg: s.deg, normalized: s.normalized };
}

/** Map a degree offset to a normalised ONVIF value in [-1, 1] using the axis calibration. */
export function degToNormalized(deg: number, axis: ICalibrationAxis): number {
  const v = axis.offset + axis.scalePerDeg * deg;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}
