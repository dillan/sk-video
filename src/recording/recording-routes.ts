import { createReadStream, type ReadStream } from 'node:fs';
import { basename } from 'node:path';
import type { IRouter, Request, Response } from 'express';
import { parseRange } from '../uploads/range';
import { isValidSegmentName } from './file-recordings';
import type { RecordingManager } from './recording-manager';
import type { ISegment } from './recording-segments';

type StreamFactory = (path: string, opts?: { start: number; end: number }) => ReadStream;

export interface IRecordingRoutesDeps {
  /** The recording manager, or null until the plugin has started. */
  getManager: () => RecordingManager | null;
  /** True if the id is a known, configured camera. */
  hasCamera: (id: string) => boolean;
  /** Current on-disk segment index (defaults to a live directory scan in index.ts). */
  listSegments: () => ISegment[];
  /** Injectable for tests; defaults to fs.createReadStream. */
  streamFactory?: StreamFactory;
}

/**
 * Registers the DVR recording endpoints, same-origin and keyed by known camera ids / safe segment
 * names:
 *   POST /cameras/:id/record  { active }  — start/stop continuous recording for a camera
 *   GET  /recordings                      — list stored segments (newest first) + the active set
 *   GET  /recordings/:name                — stream a segment with HTTP Range support
 * The manager is resolved live (created in start()), returning 503 until the plugin is started.
 * Recording is tier-gated: a host with no recording channels answers 409.
 */
export function registerRecordingRoutes(router: IRouter, deps: IRecordingRoutesDeps): void {
  const openStream = deps.streamFactory ?? (createReadStream as StreamFactory);

  const requireManager = (res: Response): RecordingManager | null => {
    const manager = deps.getManager();
    if (!manager) {
      res.status(503).json({ error: 'plugin not started' });
      return null;
    }
    return manager;
  };

  router.post('/cameras/:id/record', (req: Request, res: Response) => {
    const manager = requireManager(res);
    if (!manager) {
      return;
    }
    const id = String(req.params.id);
    if (!deps.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    const active = (req.body as { active?: unknown })?.active !== false;
    if (!active) {
      manager.stop(id);
      res.json({ recording: false });
      return;
    }
    if (!manager.start(id)) {
      // The tier offers no recording channels, or every channel is already in use.
      res.status(409).json({
        recording: false,
        error: 'recording unavailable — channel limit reached or disabled for this hardware tier',
      });
      return;
    }
    res.json({ recording: true });
  });

  router.get('/recordings', (_req: Request, res: Response) => {
    const manager = requireManager(res);
    if (!manager) {
      return;
    }
    const segments = deps
      .listSegments()
      .map((s) => ({
        camera: s.cameraId,
        name: basename(s.path),
        bytes: s.bytes,
        startedAt: s.startedAt,
      }))
      .sort((a, b) => b.startedAt - a.startedAt);
    res.json({ recording: manager.activeCameras(), segments });
  });

  router.get('/recordings/:name', (req: Request, res: Response) => {
    const manager = requireManager(res);
    if (!manager) {
      return;
    }
    const name = String(req.params.name);
    if (!isValidSegmentName(name)) {
      res.status(400).json({ error: 'invalid name' });
      return;
    }
    const segment = deps.listSegments().find((s) => basename(s.path) === name);
    if (!segment) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'private, max-age=0');

    const range = parseRange(req.headers.range, segment.bytes);
    if (range.type === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${segment.bytes}`);
      res.status(416).end();
      return;
    }

    let stream: ReadStream;
    if (range.type === 'range') {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${segment.bytes}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      stream = openStream(segment.path, { start: range.start, end: range.end });
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(segment.bytes));
      stream = openStream(segment.path);
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
