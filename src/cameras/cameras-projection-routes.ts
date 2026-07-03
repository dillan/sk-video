import type { IRouter, Request, Response } from 'express';
import type { ICamera } from './camera-validation';
import { computeLayoutHints, type ILayoutHints } from './layout-hints';
import type { IStreamHealth } from '../gateway/stream-health';
import { transportHints, type ITransportHints } from '../gateway/transport-hints';
import type { ILastGood } from '../gateway/last-good';

/**
 * Aggregate camera projection for the Live Wall: definitions + per-camera health (with last-good) +
 * the server-computed transport walk + layout hints, in ONE response — the wall is the heaviest
 * screen on the worst link (a Pi over marina wifi), so it must not fan out N health + N transport
 * requests. Read-only and source-free: the network endpoint never rides along (the console plays
 * through the same-origin proxy and has no use for camera addresses). Camera CRUD stays on the
 * Signal K Resources API — this is a view, not a second write path.
 */

export interface ICameraProjectionEntry {
  id: string;
  name: string;
  enabled: boolean;
  role?: string;
  safetyCritical: boolean;
  placement?: ICamera['placement'];
  capabilities?: ICamera['capabilities'];
  media?: ICamera['media'];
  device?: ICamera['device'];
  /** go2rtc health merged with the last-good tracker; null while the gateway is down. */
  health: (IStreamHealth & ILastGood) | null;
  /** The server-recommended transport walk; null while the gateway is down. */
  transport: ITransportHints | null;
}

export interface ICamerasProjection {
  /** False when go2rtc was unreachable — defs still serve so the wall can render honestly. */
  gatewayOnline: boolean;
  cameras: ICameraProjectionEntry[];
  layout: ILayoutHints;
}

export interface ICamerasProjectionDeps {
  /** The camera definitions, or null before the store is ready. */
  listCameras: () => Record<string, ICamera> | null;
  /** One bulk go2rtc read for every listed camera id; throws when the gateway is down. */
  fetchAllHealth: (ids: string[]) => Promise<Record<string, IStreamHealth>>;
  lastGood: (id: string) => ILastGood;
}

export function registerCamerasProjectionRoute(
  router: IRouter,
  deps: ICamerasProjectionDeps,
): void {
  router.get('/cameras', async (_req: Request, res: Response) => {
    const cams = deps.listCameras();
    if (cams === null) {
      res.status(503).json({ error: 'not ready' });
      return;
    }
    let healths: Record<string, IStreamHealth> | null;
    try {
      healths = await deps.fetchAllHealth(Object.keys(cams));
    } catch {
      healths = null; // gateway down — defs still render, health/transport read null (honest)
    }
    const cameras: ICameraProjectionEntry[] = Object.entries(cams).map(([id, c]) => {
      const health = healths?.[id] ?? null;
      return {
        id,
        name: c.name,
        enabled: c.enabled,
        role: c.role,
        safetyCritical: c.safetyCritical === true,
        placement: c.placement,
        capabilities: c.capabilities,
        media: c.media,
        device: c.device,
        health: health ? { ...health, ...deps.lastGood(id) } : null,
        transport: health ? transportHints(health) : null,
      };
    });
    const projection: ICamerasProjection = {
      gatewayOnline: healths !== null,
      cameras,
      layout: computeLayoutHints(cams),
    };
    res.json(projection);
  });
}
