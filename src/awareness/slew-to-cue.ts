import { computeAim, type IAim, type ICameraAimConfig, type ILatLon } from '../safety/mob-geo';
import { nearestCpaTarget, type IAisTarget, type INearestCpaOptions } from './ais-targets';
import type { ICpaResult, IKinematics } from './cpa';

/**
 * Pure slew-to-cue plan: pick the highest-collision-risk AIS target and compute the normalised pan/
 * tilt to bring it into frame, reusing the MOB geo-pointing engine (computeAim) so the two never
 * diverge. This is a SINGLE deterministic aim — not visual tracking and not the MOB safety feature.
 * Returns null when the camera can't be geo-pointed (no calibration) or no target qualifies.
 */

export interface ISlewOwnShip {
  position: ILatLon;
  /** Reference heading for aiming, degrees [0, 360) — true heading, or COG as a fallback. */
  headingDeg: number;
  /** Speed over ground (m/s) and course over ground (deg) — the motion vector for CPA. */
  sogMps: number;
  cogDeg: number;
}

export interface ISlewPlan {
  aim: IAim;
  target: IAisTarget;
  cpa: ICpaResult;
}

export function planSlew(
  own: ISlewOwnShip,
  targets: IAisTarget[],
  camera: ICameraAimConfig,
  options?: INearestCpaOptions,
): ISlewPlan | null {
  if (!camera.calibration) {
    return null; // an uncalibrated camera can't be geo-pointed
  }
  const ownKinematics: IKinematics = {
    position: own.position,
    sogMps: own.sogMps,
    cogDeg: own.cogDeg,
  };
  const nearest = nearestCpaTarget(ownKinematics, targets, options);
  if (!nearest) {
    return null;
  }
  const aim = computeAim(
    { position: own.position, headingDeg: own.headingDeg },
    nearest.target.position,
    camera,
  );
  if (!aim) {
    return null;
  }
  return { aim, target: nearest.target, cpa: nearest.cpa };
}
