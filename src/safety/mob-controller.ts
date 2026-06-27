import type { ILatLon, IOwnShip, ICameraAimConfig } from './mob-geo';

/**
 * The deterministic man-overboard response. On activation it raises an emergency notification, drops
 * a position marker, snapshots every camera, and aims every capable PTZ camera at the MOB target —
 * recomputed from live own-ship position as the boat drifts off it. The target is, in priority order,
 * a live MOB beacon (AIS-MOB/SART) position, else the dead-reckoned datum captured at the trigger.
 * It NEVER depends on visually detecting the person: it points at the known position, and supports —
 * never replaces — standard MOB procedure.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface IMobCamera {
  id: string;
  hasAbsolutePtz: boolean;
  aimConfig: ICameraAimConfig;
}

export interface IMobControllerDeps {
  /** Current own-ship position + heading, or null when unknown. */
  getOwnShip: () => IOwnShip | null;
  /** Live MOB beacon (AIS-MOB/SART) position if one is associated with the event, else null. */
  getBeaconTarget: () => ILatLon | null;
  /** Enabled cameras with their PTZ capability + aim config. */
  getCameras: () => IMobCamera[];
  aimCamera: (id: string, pan: number, tilt: number) => void;
  raiseNotification: (message: string, position: ILatLon | null) => void;
  clearNotification: () => void;
  emitMarker: (target: ILatLon) => void;
  snapshotAll: () => void;
  reaimIntervalMs?: number;
  setIntervalImpl?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalImpl?: (token: ReturnType<typeof setInterval>) => void;
}

export interface IMobStatus {
  active: boolean;
  targetSource: 'beacon' | 'datum' | 'none';
  aimedCameras: number;
}

export class MobController {
  constructor(private readonly deps: IMobControllerDeps) {
    void this.deps;
  }

  activate(): IMobStatus {
    return { active: false, targetSource: 'none', aimedCameras: 0 };
  }

  deactivate(): void {
    // stub
  }

  isActive(): boolean {
    return false;
  }
}
