import type { IRouter, Request, Response } from 'express';
import type { AuthGate } from '../security/request-auth';
import {
  validateOperationalConfig,
  redactConfig,
  mergeConfig,
  type IOperationalConfig,
} from './operational-config';

export interface IConfigRouteDeps {
  /** The plugin's current operational config, or null until started. */
  getConfig: () => IOperationalConfig | null;
  /** Persist + apply a new config — wraps the Signal K restart() contract (saves, then restarts). */
  applyConfig: (next: IOperationalConfig) => void;
}

/**
 * Operational config surface (same-origin), owned by the SK Video web app so the Signal K admin form
 * stays empty:
 *   GET /operational-config — current config, write-only Frigate password redacted to a presence flag
 *   PUT /operational-config — validate + merge (preserving the password) + apply via restart()
 * Both gated (management). Saving briefly restarts the plugin to re-wire MQTT / delta subscriptions /
 * timers — the response says so, the web app warns about the short video reconnect.
 *
 * NOTE the path is `/operational-config`, NOT `/config`: signalk-server itself owns
 * `GET/POST /plugins/:id/config` (the raw options envelope the admin uses), so a `/config` route here
 * would be shadowed by the server's built-in.
 */
export function registerConfigRoutes(
  router: IRouter,
  deps: IConfigRouteDeps,
  gate: AuthGate,
): void {
  router.get('/operational-config', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    const current = deps.getConfig();
    if (!current) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    res.json(redactConfig(current));
  });

  router.put('/operational-config', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    const current = deps.getConfig();
    if (!current) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const result = validateOperationalConfig(req.body);
    if (!result.valid || !result.value) {
      res.status(400).json({ error: result.errors.join('; ') || 'invalid config' });
      return;
    }
    deps.applyConfig(mergeConfig(current, result.value));
    // restart() is fire-and-forget (persist → stop → start); respond before the brief restart lands.
    res.status(200).json({ ok: true, restarting: true });
  });
}
