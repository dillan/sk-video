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
/** Below this speed over ground (~1 knot) a GPS course is noise, so COG is not a valid heading proxy. */
const SOG_MIN_FOR_COG_HEADING = 0.5;

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Own-ship state for slewing. Requires a position and an aiming reference: a true heading, or — only
 * while making way — course-over-ground (a stationary/drifting boat's GPS course is noise, so we
 * refuse it rather than aim at empty sea). Returns null when there is no usable reference.
 */
export function slewOwnShipFromSelfState(self: ISelfState): ISlewOwnShip | null {
  const pos = self.position.value;
  if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) {
    return null; // missing or garbage (NaN from flaky NMEA) position — nothing to aim from
  }
  const headingRad = finiteOrNull(self.headingTrue.value);
  const cogRad = finiteOrNull(self.courseOverGroundTrue.value);
  const sogMps = finiteOrNull(self.speedOverGround.value) ?? 0;

  let referenceRad: number;
  let headingSource: 'heading' | 'cog';
  if (headingRad !== null) {
    referenceRad = headingRad;
    headingSource = 'heading';
  } else if (cogRad !== null && sogMps >= SOG_MIN_FOR_COG_HEADING) {
    referenceRad = cogRad; // making way, so course is a usable heading proxy
    headingSource = 'cog';
  } else {
    return null; // no true heading, and not making way — nothing trustworthy to aim relative to
  }

  return {
    position: { latitude: pos.latitude, longitude: pos.longitude },
    headingDeg: norm360(referenceRad * R2D),
    headingSource,
    sogMps,
    cogDeg: cogRad !== null ? norm360(cogRad * R2D) : norm360(referenceRad * R2D),
  };
}

/** A finite number, or null for null/undefined/NaN/Infinity (flaky NMEA can deliver any of these). */
function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
