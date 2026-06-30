import { createReadStream, type ReadStream } from 'node:fs';
import type { IRouter, Request, Response } from 'express';
import { isValidSnapshotId } from './file-snapshot-store';
import type { ISnapshotMetadata } from './snapshot-service';

/** The read surface of the snapshot store (the capture path owns writes; these routes only read). */
export interface ISnapshotReadStore {
  list(): ISnapshotMetadata[];
  get(id: string): ISnapshotMetadata | null;
  blobPath(id: string): string;
}

type StreamFactory = (path: string) => ReadStream;

/**
 * Registers the snapshot library read endpoints (capture already exists at POST /cameras/:id/snapshot):
 *   GET /snapshots      — list stored snapshots (telemetry-stamped metadata), newest-first
 *   GET /snapshots/:id  — serve the stored JPEG by its opaque id
 * Both read-only and unauthenticated (snapshots carry no secrets); the id is the path-traversal guard.
 */
export function registerSnapshotReadRoutes(
  router: IRouter,
  getStore: () => ISnapshotReadStore | null,
  options: { streamFactory?: StreamFactory } = {},
): void {
  const openStream = options.streamFactory ?? (createReadStream as StreamFactory);

  const requireStore = (res: Response): ISnapshotReadStore | null => {
    const store = getStore();
    if (!store) {
      res.status(503).json({ error: 'plugin not started' });
      return null;
    }
    return store;
  };

  router.get('/snapshots', (_req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const snapshots = [...store.list()].sort((a, b) => b.createdAt - a.createdAt);
    res.json({ snapshots });
  });

  router.get('/snapshots/:id', (req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    if (!isValidSnapshotId(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const meta = store.get(id);
    if (!meta) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.setHeader('Content-Type', meta.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=0');
    const stream = openStream(store.blobPath(id));
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.destroy();
    });
    stream.pipe(res);
  });
}
