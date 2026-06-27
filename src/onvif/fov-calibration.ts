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

/** Map a degree offset to a normalised ONVIF value in [-1, 1] using the axis calibration. */
export function degToNormalized(deg: number, axis: ICalibrationAxis): number {
  const v = axis.offset + axis.scalePerDeg * deg;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}
