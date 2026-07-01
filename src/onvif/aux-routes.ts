import type { IRouter, Request, Response } from 'express';
import { redactUrl } from '../security/redact';
import type { AuthGate } from '../security/request-auth';
import { CameraNotFoundError, type PtzManager } from './ptz-manager';
import { categorizeOnvifError } from './onvif-errors';
import { classifyAuxCommands, type IAuxControls } from './aux-commands';

/**
 * ONVIF auxiliary-command controls — a white-light **spotlight** and an audible **alarm/siren**. ONVIF
 * has no standard command for these, so each camera advertises freeform aux tokens which we classify and
 * resolve to the `<token>|On` / `<token>|Off` data ONVIF `SendAuxiliaryCommand` expects. Both routes are
 * capability-gated: a camera that advertised no matching aux command answers 404. Auth-gated and
 * best-effort (a camera may ignore an unsupported command).
 *
 * UNVERIFIED on real hardware — implemented from the ONVIF spec + library behaviour, validated by tests
 * and pre-release feedback, not a live camera (our test camera advertises no aux commands).
 */

export interface IAuxRouteDeps {
  ready: () => boolean;
  getPtz: () => PtzManager | null;
  /** The stored aux-command tokens for a camera, or null when the camera is unknown. */
  getAuxCommands: (id: string) => string[] | null;
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof CameraNotFoundError) {
    res.status(404).json({ error: 'unknown camera' });
    return;
  }
  const { reason, hint } = categorizeOnvifError(err);
  res.status(502).json({
    error: hint,
    reason,
    detail: redactUrl(err instanceof Error ? err.message : 'aux command failed'),
  });
}

function registerOne(
  router: IRouter,
  deps: IAuxRouteDeps,
  gate: AuthGate,
  kind: 'spotlight' | 'alarm',
  pick: (c: IAuxControls) => IAuxControls['spotlight'],
): void {
  router.post(`/cameras/:id/${kind}`, async (req: Request, res: Response) => {
    if (gate(req, res)) return;
    if (!deps.ready()) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const id = String(req.params.id);
    const tokens = deps.getAuxCommands(id);
    if (tokens === null) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    const command = pick(classifyAuxCommands(tokens));
    if (!command) {
      res.status(404).json({ error: `camera has no ${kind} control` });
      return;
    }
    // Default OFF — only an explicit { on: true } fires the fixture (matters for the audible alarm).
    const on = (req.body as { on?: unknown })?.on === true;
    const ptz = deps.getPtz();
    if (!ptz) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    try {
      const controller = await ptz.controllerFor(id);
      await controller.sendAux(on ? command.on : command.off);
      res.status(204).end();
    } catch (err) {
      handleError(err, res);
    }
  });
}

export function registerAuxRoutes(router: IRouter, deps: IAuxRouteDeps, gate: AuthGate): void {
  registerOne(router, deps, gate, 'spotlight', (c) => c.spotlight);
  registerOne(router, deps, gate, 'alarm', (c) => c.alarm);
}
