import type { IRouter, Request, Response } from 'express';
import type { IIntrospectInput, IIntrospectResult } from '../onvif/onvif-introspect';
import type { IRateLimitResult } from '../security/rate-limit';
import type { AuthGate } from '../security/request-auth';

/**
 * Registers `POST /cameras/discover/introspect` — given a discovered host (and optional write-only
 * credentials), introspect the camera over ONVIF and return pre-filled add-camera fields so the user
 * never hand-types an RTSP path. Credentials are used for the one probe and never stored. The host is
 * SSRF-checked and the route is rate-limited, since it accepts credentials and reaches out to a host.
 */

const HOST_RE = /^[A-Za-z0-9._:-]+$/;

export interface IIntrospectRouteContext {
  ready: () => boolean;
  assertHostAllowed: (host: string) => Promise<void>;
  introspect: (input: IIntrospectInput) => Promise<IIntrospectResult>;
  rateLimit?: (req: Request) => IRateLimitResult;
  /** Auth gate (returns true when it already sent 401). Introspection is a management action. */
  gate?: AuthGate;
}

export function registerIntrospectRoute(router: IRouter, ctx: IIntrospectRouteContext): void {
  router.post('/cameras/discover/introspect', async (req: Request, res: Response) => {
    if (ctx.gate?.(req, res)) return;
    const limited = ctx.rateLimit?.(req);
    if (limited && !limited.ok) {
      res.setHeader('Retry-After', String(Math.ceil(limited.retryAfterMs / 1000)));
      res.status(429).json({ error: 'too many requests', retryAfterMs: limited.retryAfterMs });
      return;
    }
    if (!ctx.ready()) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }

    const body = (req.body ?? {}) as {
      host?: unknown;
      port?: unknown;
      username?: unknown;
      password?: unknown;
    };
    const host = typeof body.host === 'string' ? body.host.trim() : '';
    if (!host || !HOST_RE.test(host)) {
      res.status(400).json({ error: 'a valid host is required' });
      return;
    }
    let port: number | undefined;
    if (body.port !== undefined) {
      if (
        typeof body.port !== 'number' ||
        !Number.isInteger(body.port) ||
        body.port < 1 ||
        body.port > 65535
      ) {
        res.status(400).json({ error: 'port must be an integer between 1 and 65535' });
        return;
      }
      port = body.port;
    }

    try {
      await ctx.assertHostAllowed(host);
    } catch {
      res.status(403).json({ error: 'that address isn’t allowed' });
      return;
    }

    try {
      const result = await ctx.introspect({
        host,
        port,
        username: typeof body.username === 'string' ? body.username : undefined,
        password: typeof body.password === 'string' ? body.password : undefined,
      });
      res.json(result);
    } catch {
      res.status(502).json({ error: 'couldn’t reach or read that camera' });
    }
  });
}
