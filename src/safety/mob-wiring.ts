import type { ICamera } from '../cameras/camera-validation';
import type { ISelfState } from '../signalk/sk-bridge';
import type { IMobCamera } from './mob-controller';
import type { ILatLon, IOwnShip } from './mob-geo';

/**
 * Pure glue between the plugin's data and the MOB controller: map a stored camera to its aim config,
 * turn a Signal K self-state snapshot into own-ship state (converting the heading from radians to
 * degrees), and find an AIS man-overboard beacon among the vessel targets. Kept here, tested, so the
 * plugin entrypoint stays thin.
 */

// AIS distress-beacon MMSI prefixes: 970 EPIRB-AIS, 972 AIS-SART, 974 AIS-MOB.
const BEACON_MMSI = /^9(70|72|74)\d{6}$/;

export function toMobCamera(id: string, camera: ICamera): IMobCamera {
  return {
    id,
    hasAbsolutePtz: camera.capabilities?.absolutePtz === true,
    aimConfig: {
      mountBearingDeg: camera.placement?.bearingRelativeDeg,
      calibration: camera.calibration,
    },
  };
}

export function ownShipFromSelfState(self: ISelfState): IOwnShip | null {
  const pos = self.position.value;
  const heading = self.headingTrue.value;
  if (!pos || heading === null || heading === undefined) {
    return null;
  }
  return {
    position: { latitude: pos.latitude, longitude: pos.longitude },
    headingDeg: (heading * 180) / Math.PI, // Signal K stores angles in radians
  };
}

/** Finds the position of an AIS MOB/SART/EPIRB beacon among `vessels`, or null. */
export function findMobBeacon(vessels: unknown): ILatLon | null {
  if (!vessels || typeof vessels !== 'object') {
    return null;
  }
  for (const [key, value] of Object.entries(vessels as Record<string, unknown>)) {
    const v = value as {
      mmsi?: unknown;
      navigation?: { position?: { value?: { latitude?: unknown; longitude?: unknown } } };
    };
    const mmsi = typeof v?.mmsi === 'string' ? v.mmsi : extractMmsi(key);
    if (!mmsi || !BEACON_MMSI.test(mmsi)) {
      continue;
    }
    const pos = v?.navigation?.position?.value;
    if (pos && typeof pos.latitude === 'number' && typeof pos.longitude === 'number') {
      return { latitude: pos.latitude, longitude: pos.longitude };
    }
  }
  return null;
}

function extractMmsi(key: string): string | null {
  const match = /mmsi:(\d+)/.exec(key);
  return match ? match[1] : null;
}
