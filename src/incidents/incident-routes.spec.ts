import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import type { IRouter, Request, Response } from 'express';
import { registerIncidentRoutes } from './incident-routes';
import type { AuthGate } from '../security/request-auth';
import type { IncidentController } from './incident-controller';
import type { IIncidentStore } from './incident-store';
import type { IIncidentBundle } from './incident-validation';

const ALLOW: AuthGate = () => false;
const DENY: AuthGate = (_req, res) => {
  res.status(401).json({ error: 'authentication required' });
  return true;
};

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => void>();
  const add =
    (method: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => void>) =>
      handlers.set(`${method} ${path}`, rest[rest.length - 1]);
  const router = {
    get: add('GET'),
    post: add('POST'),
    patch: add('PATCH'),
    delete: add('DELETE'),
  } as unknown as IRouter;
  return { router, handlers };
}

class FakeRes extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown;
  chunks: Buffer[] = [];
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  json(payload: unknown): this {
    this.body = payload;
    this.end();
    return this;
  }
  /** The bytes written via res.end(buffer) (e.g. the export zip). */
  get written(): Buffer {
    return Buffer.concat(this.chunks);
  }
  get headersSent(): boolean {
    return false;
  }
  override _write(c: Buffer, _e: string, cb: () => void): void {
    this.chunks.push(Buffer.from(c));
    cb();
  }
}
const fakeReq = (over: Partial<Request> & { body?: unknown } = {}): Request =>
  ({ params: {}, headers: {}, on: () => undefined, ...over }) as unknown as Request;

const bundle = (id: string, over: Partial<IIncidentBundle> = {}): IIncidentBundle =>
  ({
    id,
    status: 'complete',
    createdAt: 1000,
    finalizedAt: 2000,
    cameras: ['bow'],
    assets: [
      {
        id: 'clip1',
        kind: 'clip',
        cameraId: 'bow',
        contentType: 'video/mp4',
        size: 8,
        sha256: 'x',
        name: 'bow.mp4',
        createdAt: 1000,
      },
    ],
    failures: [],
    ...over,
  }) as IIncidentBundle;

function setup(
  seed: Record<string, IIncidentBundle> = {},
  controller?: Partial<IncidentController>,
  gate: AuthGate = ALLOW,
) {
  const map = new Map(Object.entries(seed));
  const marked: unknown[] = [];
  const deleted: string[] = [];
  const store = {
    get: (id) => map.get(id) ?? null,
    list: () => [...map.values()],
    assetPath: (id, a) => `/data/incidents/${id}/${a}`,
    patch: (id, fields) => {
      const b = map.get(id);
      if (!b) return null;
      const u = { ...b, ...fields };
      map.set(id, u);
      return u;
    },
    delete: (id) => {
      deleted.push(id);
      return map.delete(id);
    },
  } as unknown as IIncidentStore;
  const ctrl = {
    mark: (input: unknown) => {
      marked.push(input);
      return { id: 'new-inc', status: 'capturing' as const };
    },
    activeAssemblies: () => [{ id: 'inflight', createdAt: 9999 }],
    ...controller,
  } as unknown as IncidentController;

  const { router, handlers } = fakeRouter();
  registerIncidentRoutes(
    router,
    {
      getController: () => ctrl,
      getStore: () => store,
      streamFactory: (_p, opts) => {
        const full = Buffer.from('CLIPDATA');
        return Readable.from(opts ? full.subarray(opts.start, opts.end + 1) : full) as never;
      },
      readFile: () => Buffer.from('CLIPDATA'),
    },
    gate,
  );
  return { handlers, marked, deleted, map };
}

describe('registerIncidentRoutes', () => {
  it('rejects unauthenticated POST /incidents with 401 and marks nothing', () => {
    const { handlers, marked } = setup({}, undefined, DENY);
    const res = new FakeRes();
    handlers.get('POST /incidents')!(
      fakeReq({ body: { preMs: 30000, postMs: 0 } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(401);
    expect(marked).toHaveLength(0);
  });

  it('rejects unauthenticated PATCH /incidents/:id with 401 and leaves the bundle unchanged', () => {
    const { handlers, map } = setup({ inc1: bundle('inc1') }, undefined, DENY);
    const res = new FakeRes();
    handlers.get('PATCH /incidents/:id')!(
      fakeReq({ params: { id: 'inc1' }, body: { pinned: true } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(401);
    expect(map.get('inc1')!.pinned).toBeUndefined();
  });

  it('rejects unauthenticated DELETE /incidents/:id with 401 and deletes nothing', () => {
    const { handlers, deleted, map } = setup({ inc1: bundle('inc1') }, undefined, DENY);
    const res = new FakeRes();
    handlers.get('DELETE /incidents/:id')!(
      fakeReq({ params: { id: 'inc1' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(401);
    expect(deleted).toHaveLength(0);
    expect(map.has('inc1')).toBe(true);
  });

  it('does NOT gate the read-only GET /incidents route', () => {
    const { handlers } = setup({ inc1: bundle('inc1') }, undefined, DENY);
    const res = new FakeRes();
    handlers.get('GET /incidents')!(fakeReq(), res as unknown as Response);
    expect(res.statusCode).toBe(200);
  });

  it('POST /incidents validates and triggers a manual mark -> 202 with id + Location', () => {
    const { handlers, marked } = setup();
    const res = new FakeRes();
    handlers.get('POST /incidents')!(
      fakeReq({ body: { preMs: 30000, postMs: 0 } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ id: 'new-inc', status: 'capturing' });
    expect(res.headers.Location).toBe('incidents/new-inc');
    expect(marked[0]).toMatchObject({ source: 'manual', preMs: 30000, postMs: 0 });
  });

  it('POST /incidents rejects a bad body with 400', () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('POST /incidents')!(fakeReq({ body: { evil: 1 } }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('GET /incidents merges in-flight (capturing) + finalized, newest first', () => {
    const { handlers } = setup({ a: bundle('a', { createdAt: 1000 }) });
    const res = new FakeRes();
    handlers.get('GET /incidents')!(fakeReq(), res as unknown as Response);
    const body = res.body as { incidents: { id: string; status: string }[] };
    expect(body.incidents[0]).toMatchObject({ id: 'inflight', status: 'capturing' });
    expect(body.incidents.map((i) => i.id)).toEqual(['inflight', 'a']);
  });

  it('GET /incidents/:id returns the manifest, 404s a miss, 400s a bad id', () => {
    const { handlers } = setup({ a: bundle('a') });
    const ok = new FakeRes();
    handlers.get('GET /incidents/:id')!(
      fakeReq({ params: { id: 'a' } }),
      ok as unknown as Response,
    );
    expect((ok.body as IIncidentBundle).id).toBe('a');
    const miss = new FakeRes();
    handlers.get('GET /incidents/:id')!(
      fakeReq({ params: { id: 'b' } }),
      miss as unknown as Response,
    );
    expect(miss.statusCode).toBe(404);
    const bad = new FakeRes();
    handlers.get('GET /incidents/:id')!(
      fakeReq({ params: { id: '../x' } }),
      bad as unknown as Response,
    );
    expect(bad.statusCode).toBe(400);
  });

  it('GET asset streams with Range, nosniff, and a sanitized disposition', () => {
    const { handlers } = setup({ a: bundle('a') });
    const res = new FakeRes();
    handlers.get('GET /incidents/:id/assets/:assetId')!(
      fakeReq({ params: { id: 'a', assetId: 'clip1' }, headers: { range: 'bytes=0-3' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-3/8');
    expect(res.headers['Content-Type']).toBe('video/mp4');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('GET asset 404s an asset id not in the bundle', () => {
    const { handlers } = setup({ a: bundle('a') });
    const res = new FakeRes();
    handlers.get('GET /incidents/:id/assets/:assetId')!(
      fakeReq({ params: { id: 'a', assetId: 'nope' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(404);
  });

  it('PATCH applies the editable subset and rejects unknown keys', () => {
    const { handlers, map } = setup({ a: bundle('a') });
    const ok = new FakeRes();
    handlers.get('PATCH /incidents/:id')!(
      fakeReq({ params: { id: 'a' }, body: { label: 'grounding', pinned: true } }),
      ok as unknown as Response,
    );
    expect(ok.statusCode).toBe(200);
    expect(map.get('a')).toMatchObject({ label: 'grounding', pinned: true });
    const bad = new FakeRes();
    handlers.get('PATCH /incidents/:id')!(
      fakeReq({ params: { id: 'a' }, body: { status: 'failed' } }),
      bad as unknown as Response,
    );
    expect(bad.statusCode).toBe(400);
  });

  it('DELETE removes a bundle but 409s a pinned one', () => {
    const { handlers, deleted } = setup({ a: bundle('a'), p: bundle('p', { pinned: true }) });
    const ok = new FakeRes();
    handlers.get('DELETE /incidents/:id')!(
      fakeReq({ params: { id: 'a' } }),
      ok as unknown as Response,
    );
    expect(ok.statusCode).toBe(204);
    expect(deleted).toEqual(['a']);
    const pinned = new FakeRes();
    handlers.get('DELETE /incidents/:id')!(
      fakeReq({ params: { id: 'p' } }),
      pinned as unknown as Response,
    );
    expect(pinned.statusCode).toBe(409);
  });

  it('returns 503 before the plugin has started', () => {
    const { router, handlers } = fakeRouter();
    registerIncidentRoutes(router, { getController: () => null, getStore: () => null }, ALLOW);
    const res = new FakeRes();
    handlers.get('GET /incidents')!(fakeReq(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
  });

  it('exports a bundle as an attachment .zip containing the manifest and assets', async () => {
    const { handlers } = setup({ inc1: bundle('inc1') });
    const res = new FakeRes();
    handlers.get('GET /incidents/:id/export.zip')!(
      fakeReq({ params: { id: 'inc1' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/zip');
    expect(res.headers['Content-Disposition']).toContain('attachment');
    expect(res.headers['Content-Disposition']).toContain('incident-inc1.zip');
    const AdmZip = (await import('adm-zip')).default;
    const names = new AdmZip(res.written).getEntries().map((e) => e.entryName);
    expect(names).toContain('manifest.json');
    expect(names).toContain('README.txt');
    expect(names).toContain('clips/bow.mp4');
  });

  it('rejects an invalid id and 404s an unknown export', () => {
    const { handlers } = setup({ inc1: bundle('inc1') });
    const bad = new FakeRes();
    handlers.get('GET /incidents/:id/export.zip')!(
      fakeReq({ params: { id: 'bad/../id' } }),
      bad as unknown as Response,
    );
    expect(bad.statusCode).toBe(400);
    const missing = new FakeRes();
    handlers.get('GET /incidents/:id/export.zip')!(
      fakeReq({ params: { id: 'nope' } }),
      missing as unknown as Response,
    );
    expect(missing.statusCode).toBe(404);
  });
});
