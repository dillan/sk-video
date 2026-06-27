import { computeAim } from './mob-geo';
import type { ILatLon, IOwnShip, ICameraAimConfig } from './mob-geo';

/**
 * The deterministic man-overboard response. On activation it raises an emergency notification, drops
 * a position marker, snapshots every camera, and aims every capable PTZ camera at the MOB target —
 * recomputed from live own-ship position as the boat drifts off it. The target is, in priority order,
 * a live MOB beacon (AIS-MOB/SART) position, else the dead-reckoned datum captured at the trigger.
 * It NEVER depends on visually detecting the person: it points at the known position, and supports —
 * never replaces — standard MOB procedure.
 */

const DEFAULT_REAIM_MS = 1500;
const MOB_MESSAGE =
  'Person overboard — cameras are pointed at the last known position, not tracking the person.';

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
  private datum: ILatLon | null = null;
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly setIntervalImpl: NonNullable<IMobControllerDeps['setIntervalImpl']>;
  private readonly clearIntervalImpl: NonNullable<IMobControllerDeps['clearIntervalImpl']>;
  private readonly reaimIntervalMs: number;

  constructor(private readonly deps: IMobControllerDeps) {
    this.setIntervalImpl = deps.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;
    this.reaimIntervalMs = deps.reaimIntervalMs ?? DEFAULT_REAIM_MS;
  }

  /** Trigger the MOB response: capture the datum, alert + snapshot, aim, and start re-aiming. */
  activate(): IMobStatus {
    const ship = this.deps.getOwnShip();
    this.datum = ship ? ship.position : null;
    this.active = true;

    const target = this.currentTarget();
    this.deps.raiseNotification(MOB_MESSAGE, target);
    if (target) {
      this.deps.emitMarker(target);
    }
    this.deps.snapshotAll();

    const aimed = this.reaim();
    if (this.timer === null) {
      this.timer = this.setIntervalImpl(() => this.reaim(), this.reaimIntervalMs);
    }
    return { active: true, targetSource: this.targetSource(), aimedCameras: aimed };
  }

  /** End the MOB response: stop re-aiming and clear the alarm. */
  deactivate(): void {
    if (this.timer !== null) {
      this.clearIntervalImpl(this.timer);
      this.timer = null;
    }
    this.active = false;
    this.datum = null;
    this.deps.clearNotification();
  }

  isActive(): boolean {
    return this.active;
  }

  /** Aim every capable camera at the current target; returns how many were aimed. */
  private reaim(): number {
    if (!this.active) {
      return 0;
    }
    const ship = this.deps.getOwnShip();
    const target = this.currentTarget();
    if (!ship || !target) {
      return 0;
    }
    let count = 0;
    for (const camera of this.deps.getCameras()) {
      if (!camera.hasAbsolutePtz) {
        continue;
      }
      const aim = computeAim(ship, target, camera.aimConfig);
      if (aim) {
        this.deps.aimCamera(camera.id, aim.pan, aim.tilt);
        count += 1;
      }
    }
    return count;
  }

  /** The live beacon position wins over the dead-reckoned datum. */
  private currentTarget(): ILatLon | null {
    return this.deps.getBeaconTarget() ?? this.datum;
  }

  private targetSource(): 'beacon' | 'datum' | 'none' {
    if (this.deps.getBeaconTarget()) {
      return 'beacon';
    }
    return this.datum ? 'datum' : 'none';
  }
}
