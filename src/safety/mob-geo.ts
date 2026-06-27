/**
 * Pure geo-pointing maths for aiming a PTZ camera at a fixed geographic target (a man-overboard
 * datum or a beacon position) from a moving vessel. Given own-ship position + heading and a target
 * lat/lon, it computes the great-circle bearing, makes it relative to where the camera is mounted,
 * and maps that through the camera's FOV calibration to a normalised ONVIF pan. There is no person
 * detection here — this is deterministic "point at the known position" geometry.
 */
import { degToNormalized } from '../onvif/fov-calibration';

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

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
export function bearingTo(from: ILatLon, to: ILatLon): number {
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed difference `bearing - reference`, normalised to (-180, 180]. */
export function relativeBearing(bearing: number, reference: number): number {
  let diff = (bearing - reference) % 360;
  if (diff <= -180) {
    diff += 360;
  } else if (diff > 180) {
    diff -= 360;
  }
  return diff;
}

/**
 * Computes the normalised pan/tilt to aim a camera at `target`, or null when the camera lacks the
 * calibration needed to geo-point (a fixed, non-PTZ or uncalibrated camera).
 */
export function computeAim(ship: IOwnShip, target: ILatLon, camera: ICameraAimConfig): IAim | null {
  if (!camera.calibration) {
    return null;
  }
  const bearing = bearingTo(ship.position, target);
  const relativeToBow = relativeBearing(bearing, ship.headingDeg);
  const panAngleDeg = relativeBearing(relativeToBow, camera.mountBearingDeg ?? 0);
  return {
    pan: degToNormalized(panAngleDeg, camera.calibration.pan),
    // The casualty is at the waterline; 0° elevation is the right default without a range estimate.
    tilt: degToNormalized(0, camera.calibration.tilt),
  };
}
