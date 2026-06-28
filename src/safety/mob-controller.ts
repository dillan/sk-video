import { computeAim, distanceMeters } from './mob-geo';
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
// A distress beacon farther than this from the dead-reckoned datum is almost certainly a DIFFERENT
// vessel's emergency (an unrelated AIS-SART/EPIRB), not our casualty — so it must not hijack the aim.
// Generous on purpose: a real casualty stays well within this even after a long drift, so the gate only
// rejects the clearly-unrelated. With no datum we have nothing to compare against and use the beacon.
const MAX_BEACON_DRIFT_M = 18_520; // 10 nautical miles

type TargetSource = 'beacon' | 'datum' | 'none';

/**
 * An HONEST emergency message: never claim cameras are pointed when there is no fix, and never imply
 * the system is tracking the person. Reflects the real target source and how many cameras were actually
 * commanded toward it.
 */
function mobMessage(source: TargetSource, commanded: number): string {
  if (source === 'none') {
    return 'Person overboard — NO position fix available; cameras could NOT be aimed. Follow standard MOB procedure.';
  }
  const where =
    source === 'beacon' ? 'the live distress-beacon position' : 'the last known position';
  if (commanded === 0) {
    return `Person overboard — position marked at ${where}; no PTZ camera could be aimed there. Follow standard MOB procedure.`;
  }
  return `Person overboard — ${commanded} camera(s) commanded toward ${where} (best-effort aim, not visually tracking the person). Follow standard MOB procedure.`;
}

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
  /** Start recording the given cameras (best-effort; tier may decline). */
  recordCameras?: (cameraIds: string[]) => void;
  /** Stop the recordings this MOB event started. */
  stopRecording?: () => void;
  /** Whether it is currently dark enough that a low-light camera preset would help (dusk/night). */
  isDark?: () => boolean;
  /** Apply the low-light imaging preset to the given cameras (best-effort; capability-gated upstream). */
  applyLowLight?: (cameraIds: string[]) => void;
  reaimIntervalMs?: number;
  setIntervalImpl?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalImpl?: (token: ReturnType<typeof setInterval>) => void;
  /** Optional logger so a re-aim failure is recorded rather than silently swallowed. */
  log?: (msg: string) => void;
}

export interface IMobStatus {
  active: boolean;
  targetSource: TargetSource;
  /**
   * How many cameras were COMMANDED toward the target with a valid, in-range geo solution this cycle.
   * It excludes cameras saturated at their pan limit (they point at the limit, not the target) and is
   * NOT a confirmation the PTZ move completed — a flaky camera may reject the command (logged upstream).
   */
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
    if (this.active) {
      // Re-triggering an already-active MOB must NOT recapture the datum — a panicked double-press
      // would otherwise move the search datum from where the person went over to the boat's now-drifted
      // position. Just re-aim at the existing datum and report status.
      return { active: true, targetSource: this.targetSource(), aimedCameras: this.reaim() };
    }
    const ship = this.deps.getOwnShip();
    this.datum = ship ? ship.position : null;
    this.active = true;

    const target = this.currentTarget();
    this.deps.snapshotAll();
    const cameraIds = this.deps.getCameras().map((camera) => camera.id);
    this.deps.recordCameras?.(cameraIds);
    // After dusk, nudge cameras into their low-light preset so the recorded evidence and any PTZ aim
    // see as much as the hardware allows. Best-effort and capability-gated; never blocks the aim.
    if (this.deps.isDark?.()) {
      this.deps.applyLowLight?.(cameraIds);
    }

    // Dispatch the aim first (a fast, non-blocking dispatch) so the emergency notification can report
    // honestly how many cameras were actually commanded toward the target.
    const aimed = this.reaim();
    const source = this.targetSource();
    this.deps.raiseNotification(mobMessage(source, aimed), target);
    if (target) {
      this.deps.emitMarker(target);
    }
    if (this.timer === null) {
      this.timer = this.setIntervalImpl(() => this.safeReaim(), this.reaimIntervalMs);
    }
    return { active: true, targetSource: source, aimedCameras: aimed };
  }

  /** Re-aim, never letting a throw escape into the interval timer (which would crash the process). */
  private safeReaim(): void {
    try {
      this.reaim();
    } catch (err) {
      this.deps.log?.(`mob re-aim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** End the MOB response: stop re-aiming and clear the alarm. */
  deactivate(): void {
    if (this.timer !== null) {
      this.clearIntervalImpl(this.timer);
      this.timer = null;
    }
    this.active = false;
    this.datum = null;
    this.deps.stopRecording?.();
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
    let commanded = 0;
    for (const camera of this.deps.getCameras()) {
      if (!camera.hasAbsolutePtz) {
        continue;
      }
      const aim = computeAim(ship, target, camera.aimConfig);
      if (!aim) {
        continue;
      }
      // Dispatch even a clamped aim (the camera goes to its limit — the best it can do), but do NOT
      // count it as aimed at the target: a saturated camera points at its mechanical limit, not the
      // casualty. The honest count drives the operator-facing notification.
      this.deps.aimCamera(camera.id, aim.pan, aim.tilt);
      if (!aim.panClamped) {
        commanded += 1;
      }
    }
    return commanded;
  }

  /**
   * The live beacon position wins over the dead-reckoned datum — but only when it is plausibly OUR
   * casualty: within MAX_BEACON_DRIFT_M of the datum (an unrelated vessel's distress beacon must not
   * hijack the aim). With no datum to compare against, the beacon is the best target we have.
   */
  private currentTarget(): ILatLon | null {
    return this.beaconTarget() ?? this.datum;
  }

  /** The associated beacon position, or null when there is none or it is too far to be our casualty. */
  private beaconTarget(): ILatLon | null {
    const beacon = this.deps.getBeaconTarget();
    if (!beacon) {
      return null;
    }
    if (this.datum && distanceMeters(beacon, this.datum) > MAX_BEACON_DRIFT_M) {
      return null; // implausibly far from where the person went over -> a different incident
    }
    return beacon;
  }

  private targetSource(): 'beacon' | 'datum' | 'none' {
    if (this.beaconTarget()) {
      return 'beacon';
    }
    return this.datum ? 'datum' : 'none';
  }
}
