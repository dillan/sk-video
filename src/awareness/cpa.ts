import { bearingTo, type ILatLon } from '../safety/mob-geo';

/**
 * Pure closest-point-of-approach maths for AIS slew-to-cue. Given own-ship and a target's position +
 * course-over-ground + speed-over-ground, it projects both into a local east/north metre frame around
 * own-ship and solves the standard relative-motion CPA: the minimum range the two will reach and the
 * time to it. Positive TCPA means the target is still approaching; negative means CPA is already past.
 * No tracking, no prediction beyond constant-velocity geometry — a single deterministic computation.
 */

const EARTH_RADIUS_M = 6_371_000;
const D2R = Math.PI / 180;
/** Below this relative speed the two are effectively co-moving; TCPA is undefined, so report "now". */
const MIN_REL_SPEED_MPS = 1e-3;

export interface IKinematics {
  position: ILatLon;
  /** Speed over ground, metres per second. */
  sogMps: number;
  /** Course over ground, degrees [0, 360). */
  cogDeg: number;
}

export interface ICpaResult {
  /** Closest range the two will reach, metres (the current range when already separating). */
  cpaMeters: number;
  /** Seconds until CPA; 0 when co-moving, negative when CPA is already in the past. */
  tcpaSeconds: number;
  /** Current range between own-ship and the target, metres. */
  rangeMeters: number;
  /** Current bearing to the target, degrees [0, 360). */
  bearingDeg: number;
}

/** Great-circle-ish distance over short marine ranges (equirectangular projection), metres. */
export function distanceMeters(a: ILatLon, b: ILatLon): number {
  const { east, north } = offsetMeters(a, b);
  return Math.hypot(east, north);
}

/** East/north metre offset of `to` relative to `from` (local tangent plane). */
function offsetMeters(from: ILatLon, to: ILatLon): { east: number; north: number } {
  const midLat = ((from.latitude + to.latitude) / 2) * D2R;
  const east = (to.longitude - from.longitude) * D2R * Math.cos(midLat) * EARTH_RADIUS_M;
  const north = (to.latitude - from.latitude) * D2R * EARTH_RADIUS_M;
  return { east, north };
}

/** Velocity components (east, north) m/s from a course/speed over ground. */
function velocity(k: IKinematics): { east: number; north: number } {
  const cog = k.cogDeg * D2R;
  return { east: k.sogMps * Math.sin(cog), north: k.sogMps * Math.cos(cog) };
}

/** Solve the constant-velocity CPA between own-ship and a target. */
export function computeCpa(own: IKinematics, target: IKinematics): ICpaResult {
  const p = offsetMeters(own.position, target.position); // relative position (east, north)
  const vOwn = velocity(own);
  const vTgt = velocity(target);
  const vEast = vTgt.east - vOwn.east;
  const vNorth = vTgt.north - vOwn.north;

  const rangeMeters = Math.hypot(p.east, p.north);
  const bearingDeg = bearingTo(own.position, target.position);
  const relSpeed2 = vEast * vEast + vNorth * vNorth;

  if (relSpeed2 < MIN_REL_SPEED_MPS * MIN_REL_SPEED_MPS) {
    return { cpaMeters: rangeMeters, tcpaSeconds: 0, rangeMeters, bearingDeg };
  }
  const tcpaSeconds = -(p.east * vEast + p.north * vNorth) / relSpeed2;
  const cpaEast = p.east + vEast * tcpaSeconds;
  const cpaNorth = p.north + vNorth * tcpaSeconds;
  return { cpaMeters: Math.hypot(cpaEast, cpaNorth), tcpaSeconds, rangeMeters, bearingDeg };
}
