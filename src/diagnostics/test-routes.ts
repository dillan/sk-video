import type { IRouter, Request, Response } from 'express';
import { validateCamera } from '../cameras/camera-validation';
import { buildGo2rtcSource, type ICameraCredentials } from '../gateway/go2rtc-source';
import {
  buildFfprobeArgs,
  evaluateFfprobe,
  evaluateTcp,
  type TFfprobeRunner,
  type TTcpProbe,
} from './probe';

export interface ITestContext {
  /** Whether the plugin has started (so the SSRF guard is wired). */
  ready: () => boolean;
  /** Same SSRF egress guard the add-camera path uses; rejects a disallowed address. */
  assertHostAllowed: (host: string) => Promise<void>;
  runFfprobe: TFfprobeRunner;
  tcpProbe: TTcpProbe;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_ONVIF_PORT = 80;

/**
 * Registers `POST /cameras/test` — a connection test for an unsaved camera. The body carries the same
 * structured `source` fields a camera resource uses, plus optional write-only credentials. The source
 * is validated (scheme allow-list, host/port/path), SSRF-checked, then probed. Credentials are used for
 * the single probe and never stored or echoed back.
 */
export function registerTestRoutes(router: IRouter, ctx: ITestContext): void {
  router.post('/cameras/test', async (req: Request, res: Response) => {
    if (!ctx.ready()) {
      res.status(503).json({ ok: false, message: 'plugin not started' });
      return;
    }

    const body = (req.body ?? {}) as { source?: unknown; username?: unknown; password?: unknown };
    const validation = validateCamera({ name: 'probe', enabled: true, source: body.source });
    if (!validation.valid || !validation.value) {
      res
        .status(400)
        .json({ ok: false, message: validation.errors.join('. ') || 'Invalid camera details.' });
      return;
    }
    const camera = validation.value;

    try {
      await ctx.assertHostAllowed(camera.source.host);
    } catch {
      res.status(403).json({ ok: false, message: 'That address isn’t allowed.' });
      return;
    }

    const timeout = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      if (camera.source.scheme === 'onvif') {
        const reachable = await ctx.tcpProbe(
          camera.source.host,
          camera.source.port ?? DEFAULT_ONVIF_PORT,
          timeout,
        );
        res.json(evaluateTcp(reachable));
        return;
      }
      const creds: ICameraCredentials = {
        username: typeof body.username === 'string' ? body.username : undefined,
        password: typeof body.password === 'string' ? body.password : undefined,
      };
      const url = buildGo2rtcSource(camera, creds);
      const outcome = await ctx.runFfprobe(buildFfprobeArgs(url, timeout), timeout);
      res.json(evaluateFfprobe(outcome));
    } catch {
      // ffprobe missing or the runner threw — surface a clear, non-fatal result.
      res.json({
        ok: false,
        message: 'Couldn’t run the test (is ffmpeg installed on the server?).',
      });
    }
  });
}
