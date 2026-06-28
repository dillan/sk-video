import { createReadStream, type ReadStream } from 'node:fs';
import type { IRouter, Request, Response } from 'express';
import { isValidAssetId, type AssetStore } from '../uploads/asset-store';
import { parseRange } from '../uploads/range';

/**
 * Read-only same-origin serving of cached Frigate clips:
 *   GET /frigate/clips      — list the cached clips
 *   GET /frigate/clips/:id  — stream a clip with HTTP Range
 * Clips are written by the Frigate client (fetched from the user's Frigate on an event), not uploaded,
 * so there is no POST/DELETE here. Mirrors the hardened uploads serving (id-keyed, magic-byte
 * validated at store time, nosniff).
 */

type StreamFactory = (path: string, opts?: { start: number; end: number }) => ReadStream;

export interface IFrigateClipRouteDeps {
  getStore: () => AssetStore | null;
  streamFactory?: StreamFactory;
}

export function registerFrigateClipRoutes(router: IRouter, deps: IFrigateClipRouteDeps): void {
  const openStream = deps.streamFactory ?? (createReadStream as StreamFactory);

  const requireStore = (res: Response): AssetStore | null => {
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'plugin not started' });
      return null;
    }
    return store;
  };

  router.get('/frigate/clips', (_req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    res.json({ clips: store.list() });
  });

  router.get('/frigate/clips/:id', (req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    if (!isValidAssetId(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const asset = store.get(id);
    if (!asset) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${asset.name}"`);
    res.setHeader('Cache-Control', 'private, max-age=0');

    const range = parseRange(req.headers.range, asset.size);
    if (range.type === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${asset.size}`);
      res.status(416).end();
      return;
    }

    const path = store.pathFor(id);
    let stream: ReadStream;
    if (range.type === 'range') {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      stream = openStream(path, { start: range.start, end: range.end });
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(asset.size));
      stream = openStream(path);
    }
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.destroy();
    });
    stream.pipe(res);
  });
}
