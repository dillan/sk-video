/**
 * Per-camera field-of-view calibration maths. ONVIF `absoluteMove` takes NORMALISED pan/tilt in
 * [-1, 1], not degrees, so geo-pointing (aim a PTZ at a bearing/elevation) needs a per-camera linear
 * map from degrees to normalised units. A short two-point wizard captures two (degrees, normalised)
 * samples per axis; `solveAxis` turns them into a linear coefficient pair, and `degToNormalized`
 * applies it (clamped to the ONVIF range). This module is pure maths with no ONVIF/camera coupling.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
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
export function solveAxis(_a: ICalibrationSample, _b: ICalibrationSample): ICalibrationAxis {
  return { offset: 0, scalePerDeg: 0 };
}

/** Map a degree offset to a normalised ONVIF value in [-1, 1] using the axis calibration. */
export function degToNormalized(_deg: number, _axis: ICalibrationAxis): number {
  return 0;
}
