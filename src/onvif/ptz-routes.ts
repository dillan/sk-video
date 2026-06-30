import type { IRouter, Request, Response } from 'express';
import { redactUrl } from '../security/redact';
import type { AuthGate } from '../security/request-auth';
import { CameraNotFoundError, type PtzManager } from './ptz-manager';

function handleError(err: unknown, res: Response): void {
  if (err instanceof CameraNotFoundError) {
    res.status(404).json({ error: 'unknown camera' });
    return;
  }
  // Redact in case an upstream/ONVIF error message ever carries a credential-bearing URL.
  res
    .status(502)
    .json({ error: redactUrl(err instanceof Error ? err.message : 'PTZ command failed') });
}

/**
 * Registers ONVIF PTZ routes. The manager is resolved live (it is created in start(), which may run
 * after registerWithRouter), returning 503 until the plugin is started.
 */
export function registerPtzRoutes(
  router: IRouter,
  getPtz: () => PtzManager | null,
  gate: AuthGate,
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
