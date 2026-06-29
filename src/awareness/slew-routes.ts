import type { IRouter, Request, Response } from 'express';
import type { ICamera } from '../cameras/camera-validation';
import { redactUrl } from '../security/redact';
import type { AuthGate } from '../security/request-auth';
import { planSlew, type ISlewOwnShip } from './slew-to-cue';
import { slewCameraAimConfig } from './slew-wiring';
import type { IAisTarget, INearestCpaOptions } from './ais-targets';

/**
 * Same-origin AIS slew-to-cue endpoint. POST /cameras/:id/slew-to-cue aims the named PTZ camera once
 * at the highest-collision-risk AIS target (smallest CPA), reusing the MOB geo-pointing engine. It is
 * a SINGLE deterministic aim — not tracking — so the response says `tracking:false`; re-POST to re-cue.
 * The plan/aim logic is injected so it is testable without a live camera or Signal K bus.
 */

export interface ISlewRouteDeps {
  ready: () => boolean;
  getCamera: (id: string) => ICamera | null;
  getOwnShip: () => ISlewOwnShip | null;
  getTargets: () => IAisTarget[];
  /** Issue the absolute move (e.g. ptz.controllerFor(id).moveAbsolute). */
  aimCamera: (id: string, pan: number, tilt: number) => Promise<void>;
  options?: INearestCpaOptions;
}

const round = (n: number): number => Math.round(n);

export function registerSlewRoutes(router: IRouter, deps: ISlewRouteDeps, gate: AuthGate): void {
  void gate; // RED: accepted but not yet enforced — enforcement lands in the GREEN step
  router.post('/cameras/:id/slew-to-cue', (req: Request, res: Response) => {
    if (!deps.ready()) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const id = String(req.params.id);
    const camera = deps.getCamera(id);
    if (!camera) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    const { hasAbsolutePtz, aimConfig } = slewCameraAimConfig(camera);
    if (!hasAbsolutePtz) {
      res.status(409).json({ error: 'camera has no absolute PTZ' });
      return;
    }
    if (!aimConfig.calibration) {
      res.status(409).json({ error: 'camera is not calibrated for geo-pointing' });
      return;
    }
    const own = deps.getOwnShip();
    if (!own) {
      res.status(409).json({ error: 'no own-ship position or heading available' });
      return;
    }
    const plan = planSlew(own, deps.getTargets(), aimConfig, deps.options);
    if (!plan) {
      res.status(404).json({ error: 'no AIS target to cue on' });
      return;
    }

    void deps
      .aimCamera(id, plan.aim.pan, plan.aim.tilt)
      .then(() => {
        res.json({
          aimed: true, // the move command was issued (not a guarantee the camera has settled)
          tracking: false, // a single geo-point, not visual tracking — re-POST to re-cue
          camera: id,
          // The target's bearing is outside the camera's pan range; it points at its limit, not the target.
          outOfReach: plan.aim.panClamped,
          // Whether the aim reference was a true heading or COG (a proxy only while making way).
          headingSource: own.headingSource,
          aim: { pan: plan.aim.pan, tilt: plan.aim.tilt },
          target: {
            id: plan.target.id,
            ...(plan.target.mmsi ? { mmsi: plan.target.mmsi } : {}),
            ...(plan.target.name ? { name: plan.target.name } : {}),
            bearingDeg: round(plan.cpa.bearingDeg),
            rangeMeters: round(plan.cpa.rangeMeters),
            cpaMeters: round(plan.cpa.cpaMeters),
            tcpaSeconds: round(plan.cpa.tcpaSeconds),
            // null when the target carries no fix timestamp; flags a possibly-stale contact.
            positionAgeMs: plan.target.positionAgeMs,
            // true when the target's SOG/COG were absent and assumed (CPA is then approximate).
            motionAssumed: plan.target.motionAssumed,
          },
        });
      })
      .catch((err: unknown) => {
        res.status(502).json({
          error: redactUrl(err instanceof Error ? err.message : 'slew failed'),
        });
      });
  });
}
