import type { ICamera } from '../cameras/camera-validation';
import type { ISelfState } from '../signalk/sk-bridge';
import type { ICameraAimConfig } from '../safety/mob-geo';
import type { ISlewOwnShip } from './slew-to-cue';

/**
 * Pure glue between plugin data and the slew planner: turn a Signal K self-state snapshot into the
 * own-ship state slew-to-cue needs (heading reference + COG/SOG for CPA, radians → degrees), and map
 * a stored camera to its aim config. Kept here, tested, so the plugin entrypoint stays thin.
 */

const R2D = 180 / Math.PI;

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Own-ship state for slewing. Requires a position and an aiming reference (true heading preferred,
 * else course-over-ground). SOG/COG default to 0 when absent (a stationary own-ship is still valid).
 */
export function slewOwnShipFromSelfState(self: ISelfState): ISlewOwnShip | null {
  const pos = self.position.value;
  if (!pos) {
    return null;
  }
  const headingRad = self.headingTrue.value;
  const cogRad = self.courseOverGroundTrue.value;
  const referenceRad = headingRad ?? cogRad; // heading first; COG only as a fallback
  if (referenceRad === null || referenceRad === undefined) {
    return null; // no heading and no course — nothing to aim relative to
  }
  return {
    position: { latitude: pos.latitude, longitude: pos.longitude },
    headingDeg: norm360(referenceRad * R2D),
    sogMps: self.speedOverGround.value ?? 0,
    cogDeg:
      cogRad !== null && cogRad !== undefined ? norm360(cogRad * R2D) : norm360(referenceRad * R2D),
  };
}

/** A stored camera's PTZ capability + aim config, mirroring the MOB camera mapping. */
export function slewCameraAimConfig(camera: ICamera): {
  hasAbsolutePtz: boolean;
  aimConfig: ICameraAimConfig;
} {
  return {
    hasAbsolutePtz: camera.capabilities?.absolutePtz === true,
    aimConfig: {
      mountBearingDeg: camera.placement?.bearingRelativeDeg,
      calibration: camera.calibration,
    },
  };
}
