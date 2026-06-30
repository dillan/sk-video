import type { IRouter, Request, Response } from 'express';
import type { ICamera } from './camera-validation';
import { computeLayoutHints } from './layout-hints';

/**
 * Registers the read-only `GET /cameras/layout` convenience endpoint: structured placement/role
 * grouping hints so the KIP widget can auto-arrange feeds by area and answer role queries ("show the
 * foredeck"). The cameras resource itself already carries the raw placement/role; this is a derived
 * convenience view. The arrangement/quick-select UX lives in the separate widget repo.
 */
export function registerLayoutRoute(
  router: IRouter,
  getCameras: () => Record<string, ICamera> | null,
): void {
  router.get('/cameras/layout', (_req: Request, res: Response) => {
    const cameras = getCameras();
    if (!cameras) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    res.json(computeLayoutHints(cameras));
  });
}
