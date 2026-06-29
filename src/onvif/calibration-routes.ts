import type { IRouter, Request, Response } from 'express';
import type { ICamera } from '../cameras/camera-validation';
import type { AuthGate } from '../security/request-auth';
import { calibrationFromSamples, type ICameraCalibration } from './fov-calibration';

/**
 * Same-origin FOV-calibration capture endpoint. POST /cameras/:id/calibration takes a one-time
 * two-point-per-axis capture — for each of pan and tilt, two `{deg, normalized}` samples at different
 * angles — solves the linear degrees → normalised-ONVIF map server-side, and persists it onto the
 * camera resource. The stored calibration is what geo-pointing (MOB) and AIS slew-to-cue read to aim
 * an absolute-PTZ camera at a real-world bearing. Re-runnable: a fresh capture overwrites the old map.
 * The solve and persistence are injected so the route is testable without a live camera.
 */

export interface ICalibrationContext {
  /** Whether the camera store is wired (plugin started). */
  ready: () => boolean;
  getCamera: (id: string) => ICamera | null;
  /** Validates and persists the solved calibration onto the camera resource; throws on failure. */
  setCalibration: (id: string, calibration: ICameraCalibration) => Promise<void>;
}

export function registerCalibrationRoute(
  router: IRouter,
  ctx: ICalibrationContext,
  gate: AuthGate,
): void {
  router.post('/cameras/:id/calibration', async (req: Request, res: Response) => {
    if (gate(req, res)) return;
    if (!ctx.ready()) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const id = String(req.params.id);
    if (!ctx.getCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    const calibration = calibrationFromSamples(req.body);
    if (!calibration) {
      res.status(400).json({
        error:
          'invalid calibration: each of pan and tilt needs two {deg, normalized:-1..1} samples at different angles',
      });
      return;
    }
    try {
      await ctx.setCalibration(id, calibration);
      res.json({ calibration });
    } catch {
      res.status(500).json({ error: 'failed to save calibration' });
    }
  });
}
