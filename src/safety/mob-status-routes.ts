import type { IRouter, Request, Response } from 'express';
import type { IMobStatus } from './mob-controller';

/**
 * Read-only MOB status. A client must seed from this on every (re)connect and tab-foreground BEFORE
 * trusting delta-stream notifications, so the safety strip can never silently under-report an active
 * MOB after a reconnect. Read-only and secret-free, so no auth gate — consistent with GET /status.
 *
 * `visualRefine` is the experimental camera-nudge assist: `enabled` mirrors the operator's plugin
 * config, `active` whether it is currently armed alongside MOB. The console shows it ONLY when
 * enabled, badged NOT safety-rated (it can lock onto a wake/whitecap and reverts on track loss).
 */

export interface IMobStatusResponse extends IMobStatus {
  visualRefine: { enabled: boolean; active: boolean };
}

export interface IMobStatusRouteDeps {
  /** The controller's non-mutating status read, or null before the plugin has started. */
  status: () => IMobStatus | null;
  visualRefine: () => { enabled: boolean; active: boolean };
}

export function registerMobStatusRoute(router: IRouter, deps: IMobStatusRouteDeps): void {
  router.get('/mob', (_req: Request, res: Response) => {
    const status = deps.status();
    if (status === null) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const body: IMobStatusResponse = { ...status, visualRefine: deps.visualRefine() };
    res.json(body);
  });
}
