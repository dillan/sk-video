import type { IRouter, Request, Response } from 'express';
import type { AuthGate } from '../security/request-auth';

/**
 * Shared safety-event acknowledgement. Acking writes back to shared Signal K notification state
 * (via the bridge), so silencing an alarm at the helm silences it on every client — the plan
 * forbids a device-local ack (helm quiet, nav station still alarming). Mutating → auth-gated.
 */

// Notification keys are plugin-internal dotted names (e.g. `mob`, `cameras.bow.feedOutage`).
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface IAckRoutesDeps {
  /** Bridge ack; false when the key was never raised (or is already cleared). */
  ack: (key: string) => boolean;
  gate: AuthGate;
}

export function registerAckRoutes(router: IRouter, deps: IAckRoutesDeps): void {
  router.post('/notifications/ack', (req: Request, res: Response) => {
    if (deps.gate(req, res)) return;
    const key = String((req.body as { key?: unknown })?.key ?? '');
    if (!KEY_RE.test(key)) {
      res.status(400).json({ error: 'invalid notification key' });
      return;
    }
    if (!deps.ack(key)) {
      res.status(404).json({ error: 'no active notification under that key' });
      return;
    }
    res.status(204).end();
  });
}
