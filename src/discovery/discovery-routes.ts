import type { IRouter, Request, Response } from 'express';
import { DiscoveryService, ScanThrottledError } from './discovery-service';

/**
 * Registers the discovery endpoint. The service is resolved live (created in start(), which may run
 * after registerWithRouter), returning 503 until the plugin is started and 429 while rate-limited.
 */
export function registerDiscoveryRoutes(
  router: IRouter,
  getService: () => DiscoveryService | null,
): void {
  router.get('/cameras/discover', (_req: Request, res: Response) => {
    const service = getService();
    if (!service) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    service
      .scan()
      .then((cameras) => res.json({ cameras }))
      .catch((err: unknown) => {
        if (err instanceof ScanThrottledError) {
          res.setHeader('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
          res.status(429).json({
            error: 'discovery is rate-limited',
            retryAfterMs: err.retryAfterMs,
          });
          return;
        }
        res.status(500).json({
          error: err instanceof Error ? err.message : 'discovery failed',
        });
      });
  });
}
