/**
 * Pure geo-pointing maths for aiming a PTZ camera at a fixed geographic target (a man-overboard
 * datum or a beacon position) from a moving vessel. Given own-ship position + heading and a target
 * lat/lon, it computes the great-circle bearing, makes it relative to where the camera is mounted,
 * and maps that through the camera's FOV calibration to a normalised ONVIF pan. There is no person
 * detection here — this is deterministic "point at the known position" geometry.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface ILatLon {
  latitude: number;
  longitude: number;
}

export interface IOwnShip {
  position: ILatLon;
  /** True heading in degrees [0, 360). */
  headingDeg: number;
}

export interface IAxisCalibration {
  offset: number;
  scalePerDeg: number;
}

export interface ICameraAimConfig {
  /** Where the camera points relative to the bow, degrees clockwise (0 = forward). */
  mountBearingDeg?: number;
  /** Per-camera degrees → normalised calibration; without it the camera can't be geo-pointed. */
  calibration?: { pan: IAxisCalibration; tilt: IAxisCalibration };
}

export interface IAim {
  pan: number;
  tilt: number;
}

/** Initial great-circle bearing from `from` to `to`, in degrees [0, 360). */
export function bearingTo(_from: ILatLon, _to: ILatLon): number {
  return 0;
}

/** Signed difference `bearing - reference`, normalised to (-180, 180]. */
export function relativeBearing(_bearing: number, _reference: number): number {
  return 0;
}

/**
 * Computes the normalised pan/tilt to aim a camera at `target`, or null when the camera lacks the
 * calibration needed to geo-point (a fixed, non-PTZ or uncalibrated camera).
 */
export function computeAim(
  _ship: IOwnShip,
  _target: ILatLon,
  _camera: ICameraAimConfig,
): IAim | null {
  return null;
}
