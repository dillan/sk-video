import type { IRouter, Request, Response } from 'express';
import { redactUrl } from '../security/redact';
import type { AuthGate } from '../security/request-auth';
import { CameraNotFoundError, type PtzManager } from './ptz-manager';
import { categorizeOnvifError } from './onvif-errors';
import { planAim } from './ptz-aim';

function handleError(err: unknown, res: Response): void {
  if (err instanceof CameraNotFoundError) {
    res.status(404).json({ error: 'unknown camera' });
    return;
  }
  // Give the operator an actionable next step instead of a bare failure. Redact in case an ONVIF error
  // ever carries a credential-bearing URL; keep the raw (redacted) message as a debug detail.
  const { reason, hint } = categorizeOnvifError(err);
  res.status(502).json({
    error: hint,
    reason,
    detail: redactUrl(err instanceof Error ? err.message : 'PTZ command failed'),
  });
}

export interface IPtzRouteOptions {
  /**
   * Capability gate: true = has PTZ, false = known non-PTZ (answer 501 without touching ONVIF,
   * the radar-API idiom for unsupported operations), null/undefined = unknown (attempt it).
   */
  hasPtz?: (id: string) => boolean | null;
  /**
   * Whether the camera can hold an absolute position. When true, tap-to-aim reads the current position
   * and repositions precisely; otherwise it sends a bounded relative nudge. Defaults to false (nudge).
   */
  hasAbsolutePtz?: (id: string) => boolean | null;
}

/**
 * Registers ONVIF PTZ routes. The manager is resolved live (it is created in start(), which may run
 * after registerWithRouter), returning 503 until the plugin is started.
 */
export function registerPtzRoutes(
  router: IRouter,
  getPtz: () => PtzManager | null,
  gate: AuthGate,
  options: IPtzRouteOptions = {},
): void {
  const withController = async (
    req: Request,
    res: Response,
    fn: (ctrl: Awaited<ReturnType<PtzManager['controllerFor']>>) => Promise<void>,
  ): Promise<void> => {
    const ptz = getPtz();
    if (!ptz) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    if (options.hasPtz?.(String(req.params.id)) === false) {
      res.status(501).json({
        state: 'FAILED',
        statusCode: 501,
        message: 'camera does not support PTZ',
      });
      return;
    }
    try {
      const controller = await ptz.controllerFor(String(req.params.id));
      await fn(controller);
    } catch (err) {
      handleError(err, res);
    }
  };

  router.post('/cameras/:id/ptz', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    return withController(req, res, async (ctrl) => {
      const body = (req.body ?? {}) as { pan?: number; tilt?: number; zoom?: number };
      await ctrl.move({ pan: body.pan, tilt: body.tilt, zoom: body.zoom });
      res.status(204).end();
    });
  });

  // Tap-to-aim: {dx, dy} is the tapped point's offset from the frame centre (image space, +right/+down,
  // ~[-0.5, 0.5]). planAim turns it into an absolute reposition (calibrated cameras) or a bounded relative
  // nudge, converging the tapped point toward centre. Returns the outcome so the UI can say "aimed" /
  // "at limit". A mutating action, so it's gated.
  router.post('/cameras/:id/ptz/aim', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    return withController(req, res, async (ctrl) => {
      const body = (req.body ?? {}) as { dx?: number; dy?: number };
      const offset = { dx: Number(body.dx), dy: Number(body.dy) };
      const absolutePtz = options.hasAbsolutePtz?.(String(req.params.id)) === true;
      // With absolute pointing, read where the camera is now so the aim is a precise reposition; a
      // failed read degrades to a relative nudge rather than erroring.
      const current = absolutePtz ? await ctrl.getStatus().catch(() => null) : null;
      const plan = planAim({ absolutePtz }, current, offset);
      if (plan.kind === 'absolute') {
        await ctrl.moveAbsolute(plan.position);
      } else {
        await ctrl.moveRelative(plan.delta);
      }
      res.json({ outcome: plan.outcome, kind: plan.kind });
    });
  });

  router.post('/cameras/:id/ptz/stop', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    return withController(req, res, async (ctrl) => {
      await ctrl.stop();
      res.status(204).end();
    });
  });

  // Listing presets is a read; it stays open (no gate).
  router.get('/cameras/:id/ptz/presets', (req: Request, res: Response) =>
    withController(req, res, async (ctrl) => {
      res.json(await ctrl.getPresets());
    }),
  );

  // Current normalised PTZ position (a read; no gate). The calibration wizard captures this alongside
  // an observed real-world bearing to solve the degrees→normalised map.
  router.get('/cameras/:id/ptz/position', (req: Request, res: Response) =>
    withController(req, res, async (ctrl) => {
      res.json(await ctrl.getStatus());
    }),
  );

  router.post('/cameras/:id/ptz/preset', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    return withController(req, res, async (ctrl) => {
      const token = String((req.body as { token?: unknown })?.token ?? '');
      await ctrl.gotoPreset(token);
      res.status(204).end();
    });
  });
}
