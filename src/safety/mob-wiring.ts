import type { ICamera } from '../cameras/camera-validation';
import type { ISelfState } from '../signalk/sk-bridge';
import type { IMobCamera } from './mob-controller';
import type { ILatLon, IOwnShip } from './mob-geo';

/**
 * Pure glue between the plugin's data and the MOB controller: map a stored camera to its aim config,
 * turn a Signal K self-state snapshot into own-ship state (converting the heading from radians to
 * degrees), and find an AIS man-overboard beacon among the vessel targets. Kept here, tested, so the
 * plugin entrypoint stays thin.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

// AIS distress-beacon MMSI prefixes: 970 EPIRB-AIS, 972 AIS-SART, 974 AIS-MOB.
const BEACON_MMSI = /^9(70|72|74)\d{6}$/;

export function toMobCamera(_id: string, _camera: ICamera): IMobCamera {
  return { id: '', hasAbsolutePtz: false, aimConfig: {} };
}

export function ownShipFromSelfState(_self: ISelfState): IOwnShip | null {
  return null;
}

/** Finds the position of an AIS MOB/SART/EPIRB beacon among `vessels`, or null. */
export function findMobBeacon(_vessels: unknown): ILatLon | null {
  void BEACON_MMSI;
  return null;
}
