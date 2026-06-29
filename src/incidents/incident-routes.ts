import { createReadStream, type ReadStream } from 'node:fs';
import type { IRouter, Request, Response } from 'express';
import { parseRange } from '../uploads/range';
import type { AuthGate } from '../security/request-auth';
import { sanitizeFilename } from '../uploads/asset-store';
import {
  isValidIncidentId,
  validateTriggerRequest,
  validateIncidentPatch,
} from './incident-validation';
import type { IncidentController } from './incident-controller';
import type { IIncidentStore } from './incident-store';

/**
 * Same-origin HTTP surface for incidents, with lazy getters (503 until started). Trigger + listing
 * (finalized + in-flight) + manifest read + Range-served asset blobs + operator patch + delete. The
 * asset Range block mirrors uploads/upload-routes; contentType/size/name come from the recorded
 * manifest asset entry (never re-sniffed at serve time), with nosniff and a sanitized
 * Content-Disposition.
 */

type StreamFactory = (path: string, opts?: { start: number; end: number }) => ReadStream;

export interface IIncidentRouteDeps {
  getController: () => IncidentController | null;
  getStore: () => IIncidentStore | null;
  streamFactory?: StreamFactory;
}

export function registerIncidentRoutes(
  router: IRouter,
  deps: IIncidentRouteDeps,
  gate: AuthGate,
): void {
  const openStream = deps.streamFactory ?? (createReadStream as StreamFactory);

  const requireController = (res: Response): IncidentController | null => {
    const c = deps.getController();
    if (!c) {
      res.status(503).json({ error: 'plugin not started' });
    }
    return c;
  };
  const requireStore = (res: Response): IIncidentStore | null => {
    const s = deps.getStore();
    if (!s) {
      res.status(503).json({ error: 'plugin not started' });
    }
    return s;
  };

  // Trigger an incident. Body optional: { cameras?, preMs?, postMs?, note? }.
  router.post('/incidents', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    const controller = requireController(res);
    if (!controller) {
      return;
    }
    const result = validateTriggerRequest(req.body);
    if (!result.valid || !result.value) {
      res.status(400).json({ error: result.errors.join('; ') || 'invalid trigger' });
      return;
    }
    const started = controller.mark({ ...result.value, source: 'manual' });
    // Relative-path reference that resolves to GET /<base>/incidents/:id (a bare id would resolve to
    // /<base>/:id and 404).
    res.setHeader('Location', `incidents/${started.id}`);
    res.status(202).json(started);
  });

  // List finalized bundles + any in-flight assemblies, newest first.
  router.get('/incidents', (_req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const controller = deps.getController();
    const finalized = store.list().map((b) => ({
      id: b.id,
      status: b.status,
      createdAt: b.createdAt,
      finalizedAt: b.finalizedAt,
      cameras: b.cameras,
      pinned: b.pinned === true,
      assetCount: b.assets.length,
      failureCount: b.failures.length,
    }));
    const active = (controller?.activeAssemblies() ?? []).map((a) => ({
      id: a.id,
      status: 'capturing' as const,
      createdAt: a.createdAt,
    }));
    const incidents = [...active, ...finalized].sort((a, b) => b.createdAt - a.createdAt);
    res.json({ incidents });
  });

  // The full manifest for one bundle.
  router.get('/incidents/:id', (req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    if (!isValidIncidentId(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const bundle = store.get(id);
    if (!bundle) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(bundle);
  });

  // Range-served asset blob (clip / snapshot / telemetry).
  router.get('/incidents/:id/assets/:assetId', (req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    const assetId = String(req.params.assetId);
    if (!isValidIncidentId(id) || !isValidIncidentId(assetId)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const bundle = store.get(id);
    const asset = bundle?.assets.find((a) => a.id === assetId);
    if (!bundle || !asset) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(asset.name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=0');

    const range = parseRange(req.headers.range, asset.size);
    if (range.type === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${asset.size}`);
      res.status(416).end();
      return;
    }

    const path = store.assetPath(id, assetId);
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

  // Operator patch: label / notes / pinned only.
  router.patch('/incidents/:id', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    if (!isValidIncidentId(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const result = validateIncidentPatch(req.body);
    if (!result.valid || !result.value) {
      res.status(400).json({ error: result.errors.join('; ') || 'invalid patch' });
      return;
    }
    const updated = store.patch(id, result.value);
    if (!updated) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(updated);
  });

  // Delete a bundle (refuses a pinned one).
  router.delete('/incidents/:id', (req: Request, res: Response) => {
    if (gate(req, res)) return;
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    if (!isValidIncidentId(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const bundle = store.get(id);
    if (!bundle) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (bundle.pinned) {
      res.status(409).json({ error: 'pinned' });
      return;
    }
    res.status(store.delete(id) ? 204 : 404).end();
  });
}
