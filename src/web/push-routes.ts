import type { IRouter, Request, Response } from 'express';
import type { AuthGate } from '../security/request-auth';
import { isValidSubscription, type PushStore } from './push-store';

export interface IPushRouteDeps {
  getStore: () => PushStore | null;
  /** The VAPID public key the browser subscribes with, or null until push is configured. */
  vapidPublicKey: () => string | null;
}

/**
 * Web Push opt-in surface (same-origin):
 *   GET  /push/vapid-public-key — the application-server public key (ungated; a browser needs it
 *        before it can subscribe, and it is a public key by definition)
 *   POST /push/subscribe   { subscription }     — store a device's subscription (gated)
 *   POST /push/unsubscribe { endpoint }         — drop it (gated)
 * Subscribing/unsubscribing changes who receives safety alerts, so both are auth-gated like the other
 * mutating routes. Sending happens elsewhere (the bridge tap), never from a request.
 */
export function registerPushRoutes(router: IRouter, deps: IPushRouteDeps, gate: AuthGate): void {
  router.get('/push/vapid-public-key', (_req: Request, res: Response) => {
    const key = deps.vapidPublicKey();
    if (!key) {
      res.status(503).json({ error: 'push not configured' });
      return;
    }
    res.json({ key });
  });

  router.post('/push/subscribe', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const subscription = (req.body as { subscription?: unknown } | undefined)?.subscription;
    if (!isValidSubscription(subscription)) {
      res.status(400).json({ error: 'invalid subscription' });
      return;
    }
    store.add(subscription);
    res.status(201).json({ ok: true });
  });

  router.post('/push/unsubscribe', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint;
    if (typeof endpoint !== 'string') {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }
    store.remove(endpoint);
    res.status(204).end();
  });
}
