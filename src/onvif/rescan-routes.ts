import type { IRouter, Request, Response } from 'express';
import { redactUrl } from '../security/redact';
import type { AuthGate } from '../security/request-auth';
import type { ICamera } from '../cameras/camera-validation';
import { categorizeOnvifError } from './onvif-errors';
import type { IIntrospectInput, IIntrospectResult } from './onvif-introspect';

/**
 * Re-scan a camera's capabilities: re-run ONVIF introspection using the camera's SAVED credentials and
 * source, and return the fresh discovery (capabilities, media, aux commands, device/firmware). The
 * client merges this into the stored resource — preserving operator-set fields (name, role, placement,
 * calibration) — so a camera picks up newly-supported capabilities without being re-added. Read-only on
 * the server (it writes nothing); auth-gated because it drives a device connection with stored creds.
 */

export interface IRescanRouteDeps {
  ready: () => boolean;
  getCamera: (id: string) => ICamera | null;
  getCredentials: (id: string) => { username?: string; password?: string } | null;
  introspect: (input: IIntrospectInput) => Promise<IIntrospectResult>;
}

export function registerRescanRoutes(
  router: IRouter,
  deps: IRescanRouteDeps,
  gate: AuthGate,
): void {
  router.post('/cameras/:id/rescan', async (req: Request, res: Response) => {
    if (gate(req, res)) return;
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
    const creds = deps.getCredentials(id);
    // An RTSP camera only stored its RTSP port; ONVIF runs on a different port that the connect layer
    // probes, so only pass a port when the source itself is an onvif:// endpoint.
    const port = camera.source.scheme === 'onvif' ? camera.source.port : undefined;
    try {
      const result = await deps.introspect({
        host: camera.source.host,
        port,
        username: creds?.username,
        password: creds?.password,
      });
      res.json(result);
    } catch (err) {
      const { reason, hint } = categorizeOnvifError(err);
      res.status(502).json({
        error: hint,
        reason,
        detail: redactUrl(err instanceof Error ? err.message : 'rescan failed'),
      });
    }
  });
}
