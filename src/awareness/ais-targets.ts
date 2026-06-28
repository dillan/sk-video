import type { ILatLon } from '../safety/mob-geo';
import { computeCpa, type ICpaResult, type IKinematics } from './cpa';

/**
 * Pure extraction of AIS targets from the Signal K `vessels` tree and selection of the highest
 * collision-risk one (smallest CPA among approaching, in-range targets) for a camera to cue on. MOB
 * distress beacons are excluded — those belong to the MOB feature, not collision awareness. Course is
 * stored in radians in Signal K and normalised to degrees here.
 */

// AIS distress-beacon MMSI prefixes (EPIRB/SART/MOB) — not collision targets.
const BEACON_MMSI = /^9(70|72|74)\d{6}$/;
const R2D = 180 / Math.PI;

export interface IAisTarget {
  /** The vessels-tree key (e.g. urn:mrn:imo:mmsi:123456789). */
  id: string;
  mmsi?: string;
  name?: string;
  position: ILatLon;
  sogMps: number;
  cogDeg: number;
}

export interface INearestCpaOptions {
  /** Ignore targets currently farther than this (metres). Default 10 NM. */
  maxRangeMeters?: number;
  /** Ignore targets whose CPA is more than this far out (seconds). Default 1 hour. */
  maxTcpaSeconds?: number;
  /** The own-vessel key to exclude from the target list. */
  selfId?: string;
}

const DEFAULT_MAX_RANGE_M = 18_520; // 10 nautical miles
const DEFAULT_MAX_TCPA_S = 3_600; // 1 hour

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractMmsi(key: string): string | undefined {
  const match = /mmsi:(\d+)/.exec(key);
  return match ? match[1] : undefined;
}

/** Parse the Signal K `vessels` tree into AIS targets with a valid position (self + beacons excluded). */
export function parseAisTargets(vessels: unknown, selfId?: string): IAisTarget[] {
  if (!vessels || typeof vessels !== 'object') {
    return [];
  }
  const out: IAisTarget[] = [];
  for (const [key, value] of Object.entries(vessels as Record<string, unknown>)) {
    if (selfId && key === selfId) {
      continue;
    }
    const v = value as {
      mmsi?: unknown;
      name?: unknown;
      navigation?: {
        position?: { value?: { latitude?: unknown; longitude?: unknown } };
        speedOverGround?: { value?: unknown };
        courseOverGroundTrue?: { value?: unknown };
      };
    };
    const mmsi = typeof v?.mmsi === 'string' ? v.mmsi : extractMmsi(key);
    if (mmsi && BEACON_MMSI.test(mmsi)) {
      continue; // a MOB/SART/EPIRB beacon, not a collision target
    }
    const pos = v?.navigation?.position?.value;
    const lat = num(pos?.latitude);
    const lon = num(pos?.longitude);
    if (lat === undefined || lon === undefined) {
      continue;
    }
    const cogRad = num(v?.navigation?.courseOverGroundTrue?.value);
    out.push({
      id: key,
      ...(mmsi ? { mmsi } : {}),
      ...(typeof v?.name === 'string' ? { name: v.name } : {}),
      position: { latitude: lat, longitude: lon },
      sogMps: num(v?.navigation?.speedOverGround?.value) ?? 0,
      cogDeg: cogRad !== undefined ? (((cogRad * R2D) % 360) + 360) % 360 : 0,
    });
  }
  return out;
}

/**
 * The highest-collision-risk target to cue: the smallest-CPA target that is still approaching
 * (TCPA >= 0) and within the range/time gates. Returns null when nothing qualifies.
 */
export function nearestCpaTarget(
  own: IKinematics,
  targets: IAisTarget[],
  options: INearestCpaOptions = {},
): { target: IAisTarget; cpa: ICpaResult } | null {
  const maxRange = options.maxRangeMeters ?? DEFAULT_MAX_RANGE_M;
  const maxTcpa = options.maxTcpaSeconds ?? DEFAULT_MAX_TCPA_S;

  let best: { target: IAisTarget; cpa: ICpaResult } | null = null;
  for (const target of targets) {
    const cpa = computeCpa(own, {
      position: target.position,
      sogMps: target.sogMps,
      cogDeg: target.cogDeg,
    });
    if (cpa.tcpaSeconds < 0 || cpa.rangeMeters > maxRange || cpa.tcpaSeconds > maxTcpa) {
      continue;
    }
    if (
      !best ||
      cpa.cpaMeters < best.cpa.cpaMeters ||
      (cpa.cpaMeters === best.cpa.cpaMeters && cpa.tcpaSeconds < best.cpa.tcpaSeconds)
    ) {
      best = { target, cpa };
    }
  }
  return best;
}
