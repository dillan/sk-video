import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { IRouter, Request, Response } from 'express';
import { registerUploadRoutes } from './upload-routes';
import type { AuthGate } from '../security/request-auth';
import { AssetStore, type IAssetIndexPersistence, type IBlobStore } from './asset-store';
import { ResumableUploadStore } from './resumable-store';

const ALLOW: AuthGate = () => false;
const DENY: AuthGate = (_req, res) => {
  res.status(401).json({ error: 'authentication required' });
  return true;
};

function mp4(size = 100): Buffer {
  const head = [0, 0, 0, 0x20, ...'ftypisom'.split('').map((c) => c.charCodeAt(0))];
  const b = Buffer.alloc(Math.max(size, head.length));
  b.set(head);
  return b;
}

function makeStore(limits?: ConstructorParameters<typeof AssetStore>[0]['limits']) {
  let saved: Record<string, never> = {} as never;
  const index: IAssetIndexPersistence = {
    load: () => saved as never,
    save: (i) => {
      saved = i as never;
    },
  };
  const blobs: IBlobStore = {
    write: () => {},
    remove: () => {},
    has: () => true,
    pathFor: (id) => `/data/videos/${id}`,
    stageFromStream: (stream, maxBytes) =>
      new Promise((resolve) => {
        const headChunks: Buffer[] = [];
        let size = 0;
        let headLen = 0;
        let settled = false;
        const done = (outcome: 'ok' | 'too-large' | 'error'): void => {
          if (settled) return;
          settled = true;
          resolve({
            ref: 'staged',
            size,
            head: new Uint8Array(Buffer.concat(headChunks)),
            outcome,
          });
        };
        stream.on('data', (c: Buffer) => {
          if (settled) return;
          size += c.length;
          if (size > maxBytes) return done('too-large');
          if (headLen < 64) {
            const take = c.subarray(0, 64 - headLen);
            headChunks.push(Buffer.from(take));
            headLen += take.length;
          }
        });
        stream.on('end', () => done('ok'));
        stream.on('error', () => done('error'));
      }),
    commitStaged: () => {},
    discardStaged: () => {},
  };
  let n = 0;
  return new AssetStore({
    index,
    blobs,
    limits,
    idGen: () => `vid-${++n}`,
    now: () => 1,
  });
}

/** A router that captures handlers keyed by "METHOD path". */
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
  get headersSent(): boolean {
    return false;
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
}

function fakeReq(over: Partial<Request> & { body?: unknown } = {}): Request {
  return {
    params: {},
    headers: {},
    on: () => undefined,
    ...over,
  } as unknown as Request;
}

/** A POST /videos request as a real readable body stream (the route streams it to the store). */
function uploadReq(
  body: Buffer | Uint8Array,
  headers: Record<string, string> = {},
  params: Record<string, string> = {},
): Request {
  const stream = Readable.from(Buffer.from(body)) as unknown as Request & Readable;
  (stream as unknown as { params: unknown }).params = params;
  (stream as unknown as { headers: unknown }).headers = headers;
  return stream as never;
}

/** Invoke a captured handler and wait for the response to finish (json()/end() both fire it). */
async function handlersCall(
  handlers: Map<string, (req: Request, res: Response) => void>,
  key: string,
  req: Request,
  res: FakeRes,
): Promise<void> {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const finished = once(res, 'finish');
  handler(req, res as never);
  await finished;
}

describe('registerUploadRoutes', () => {
  function setup(store = makeStore(), streamBytes = 100, gate: AuthGate = ALLOW) {
    const { router, handlers } = fakeRouter();
    registerUploadRoutes(router, () => store, gate, {
      streamFactory: (_path, opts) => {
        const full = Buffer.alloc(streamBytes, 1);
        const slice = opts ? full.subarray(opts.start, opts.end + 1) : full;
        return Readable.from(slice) as never;
      },
    });
    return { store, handlers };
  }

  it('rejects an unauthenticated POST /videos with 401 and stores nothing', async () => {
    const store = makeStore();
    const { handlers } = setup(store, 100, DENY);
    const res = new FakeRes();
    handlers.get('POST /videos')!(uploadReq(mp4(), { 'x-filename': 'clip.mp4' }), res as never);
    await once(res, 'finish');
    expect(res.statusCode).toBe(401);
    expect(store.list()).toHaveLength(0);
  });

  it('rejects an unauthenticated DELETE /videos/:id with 401 and deletes nothing', () => {
    const store = makeStore();
    const asset = store.add(new Uint8Array(mp4()), 'a.mp4');
    const { handlers } = setup(store, 100, DENY);
    const res = new FakeRes();
    handlers.get('DELETE /videos/:id')!(fakeReq({ params: { id: asset.id } }), res as never);
    expect(res.statusCode).toBe(401);
    expect(store.get(asset.id)).toBeTruthy();
  });

  it('does NOT gate the read-only GET /videos list route', () => {
    const { handlers } = setup(makeStore(), 100, DENY);
    const res = new FakeRes();
    handlers.get('GET /videos')!(fakeReq(), res as never);
    expect(res.statusCode).toBe(200);
  });

  it('stores a valid upload and returns 201 with the asset', async () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('POST /videos')!(uploadReq(mp4(), { 'x-filename': 'clip.mp4' }), res as never);
    await once(res, 'finish');
    expect(res.statusCode).toBe(201);
    expect((res.body as { contentType: string }).contentType).toBe('video/mp4');
  });

  it('rejects a non-video upload with 415', async () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('POST /videos')!(uploadReq(Buffer.from('<html></html>')), res as never);
    await once(res, 'finish');
    expect(res.statusCode).toBe(415);
  });

  it('rejects an over-quota upload with 413', async () => {
    const { handlers } = setup(makeStore({ maxFileBytes: 10, maxTotalBytes: 10, maxFileCount: 1 }));
    const res = new FakeRes();
    handlers.get('POST /videos')!(uploadReq(mp4(100)), res as never);
    await once(res, 'finish');
    expect(res.statusCode).toBe(413);
  });

  it('serves a full body with 200 and a Content-Length', async () => {
    const { store, handlers } = setup();
    const asset = store.add(new Uint8Array(mp4(100)), 'a.mp4');
    const res = new FakeRes();
    handlers.get('GET /videos/:id')!(fakeReq({ params: { id: asset.id } }), res as never);
    await once(res, 'finish');
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Length']).toBe('100');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(Buffer.concat(res.chunks).length).toBe(100);
  });

  it('serves a byte range with 206 and Content-Range', async () => {
    const { store, handlers } = setup();
    const asset = store.add(new Uint8Array(mp4(100)), 'a.mp4');
    const res = new FakeRes();
    handlers.get('GET /videos/:id')!(
      fakeReq({ params: { id: asset.id }, headers: { range: 'bytes=0-9' } }),
      res as never,
    );
    await once(res, 'finish');
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-9/100');
    expect(Buffer.concat(res.chunks).length).toBe(10);
  });

  it('answers 416 for an unsatisfiable range', () => {
    const store = makeStore();
    const asset = store.add(new Uint8Array(mp4(100)), 'a.mp4');
    const { handlers } = setup(store);
    const res = new FakeRes();
    handlers.get('GET /videos/:id')!(
      fakeReq({
        params: { id: asset.id },
        headers: { range: 'bytes=500-600' },
      }),
      res as never,
    );
    expect(res.statusCode).toBe(416);
    expect(res.headers['Content-Range']).toBe('bytes */100');
  });

  it('rejects an invalid id and reports 404 for an unknown one', () => {
    const { handlers } = setup();
    const bad = new FakeRes();
    handlers.get('GET /videos/:id')!(fakeReq({ params: { id: 'bad/../id' } }), bad as never);
    expect(bad.statusCode).toBe(400);
    const missing = new FakeRes();
    handlers.get('GET /videos/:id')!(fakeReq({ params: { id: 'nope' } }), missing as never);
    expect(missing.statusCode).toBe(404);
  });

  it('responds 400 (upload failed) when the request stream errors mid-body', async () => {
    const { handlers } = setup();
    const res = new FakeRes();
    const req = new Readable({ read() {} }) as unknown as Request & Readable;
    (req as unknown as { params: unknown }).params = {};
    (req as unknown as { headers: unknown }).headers = {};
    handlers.get('POST /videos')!(req as never, res as never);
    // No data has been buffered yet; a mid-body stream error must settle the
    // request as a failed (non-too-large) upload rather than hang.
    req.emit('error', new Error('boom'));
    await once(res, 'finish');
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('upload failed');
  });

  it('rejects a DELETE with an invalid id (400)', () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('DELETE /videos/:id')!(fakeReq({ params: { id: 'bad/../id' } }), res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid id');
  });

  it('deletes an asset (204) then reports 404', () => {
    const store = makeStore();
    const asset = store.add(new Uint8Array(mp4()), 'a.mp4');
    const { handlers } = setup(store);
    const res1 = new FakeRes();
    handlers.get('DELETE /videos/:id')!(fakeReq({ params: { id: asset.id } }), res1 as never);
    expect(res1.statusCode).toBe(204);
    const res2 = new FakeRes();
    handlers.get('DELETE /videos/:id')!(fakeReq({ params: { id: asset.id } }), res2 as never);
    expect(res2.statusCode).toBe(404);
  });
});

describe('registerUploadRoutes — resumable uploads', () => {
  function resumableSetup(gate: AuthGate = ALLOW) {
    const dir = mkdtempSync(join(tmpdir(), 'sk-video-resumable-routes-'));
    const resumable = new ResumableUploadStore(dir);
    const store = makeStore();
    const { router, handlers } = fakeRouter();
    registerUploadRoutes(router, () => store, gate, { getResumable: () => resumable });
    return {
      store,
      resumable,
      handlers,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  const createReq = (name: string, size: number) => fakeReq({ body: { name, size } as never });

  it('creates a session, appends with offset verification, and completes into the store', async () => {
    const h = resumableSetup();
    try {
      const res1 = new FakeRes();
      await handlersCall(h.handlers, 'POST /videos/uploads', createReq('clip.mp4', 100), res1);
      expect(res1.statusCode).toBe(201);
      const { id, offset } = res1.body as { id: string; offset: number };
      expect(offset).toBe(0);

      const bytes = mp4(100);
      const res2 = new FakeRes();
      await handlersCall(
        h.handlers,
        'PATCH /videos/uploads/:id',
        uploadReq(bytes.subarray(0, 60), { 'x-upload-offset': '0' }, { id }),
        res2,
      );
      expect(res2.statusCode).toBe(204);
      expect(res2.headers['X-Upload-Offset']).toBe('60');

      // A stale/duplicate chunk answers 409 with the offset to resume from.
      const res3 = new FakeRes();
      await handlersCall(
        h.handlers,
        'PATCH /videos/uploads/:id',
        uploadReq(bytes.subarray(0, 60), { 'x-upload-offset': '0' }, { id }),
        res3,
      );
      expect(res3.statusCode).toBe(409);
      expect((res3.body as { offset: number }).offset).toBe(60);

      const res4 = new FakeRes();
      await handlersCall(
        h.handlers,
        'PATCH /videos/uploads/:id',
        uploadReq(bytes.subarray(60), { 'x-upload-offset': '60' }, { id }),
        res4,
      );
      expect(res4.statusCode).toBe(204);

      const res5 = new FakeRes();
      await handlersCall(
        h.handlers,
        'POST /videos/uploads/:id/complete',
        fakeReq({ params: { id } }),
        res5,
      );
      expect(res5.statusCode).toBe(201);
      expect((res5.body as { name: string }).name).toBe('clip.mp4');
      expect(h.store.list()).toHaveLength(1);
    } finally {
      h.cleanup();
    }
  });

  it('probes the current offset with GET (the resume handshake)', async () => {
    const h = resumableSetup();
    try {
      const res1 = new FakeRes();
      await handlersCall(h.handlers, 'POST /videos/uploads', createReq('clip.mp4', 100), res1);
      const { id } = res1.body as { id: string };
      await handlersCall(
        h.handlers,
        'PATCH /videos/uploads/:id',
        uploadReq(mp4(100).subarray(0, 40), { 'x-upload-offset': '0' }, { id }),
        new FakeRes(),
      );
      const res2 = new FakeRes();
      await handlersCall(h.handlers, 'GET /videos/uploads/:id', fakeReq({ params: { id } }), res2);
      expect(res2.statusCode).toBe(200);
      expect(res2.body).toMatchObject({ id, name: 'clip.mp4', size: 100, offset: 40 });
    } finally {
      h.cleanup();
    }
  });

  it('refuses to complete an unfinished upload with 409 + the offset', async () => {
    const h = resumableSetup();
    try {
      const res1 = new FakeRes();
      await handlersCall(h.handlers, 'POST /videos/uploads', createReq('clip.mp4', 100), res1);
      const { id } = res1.body as { id: string };
      const res2 = new FakeRes();
      await handlersCall(
        h.handlers,
        'POST /videos/uploads/:id/complete',
        fakeReq({ params: { id } }),
        res2,
      );
      expect(res2.statusCode).toBe(409);
      expect((res2.body as { offset: number }).offset).toBe(0);
    } finally {
      h.cleanup();
    }
  });

  it('maps finalize rejections honestly (junk bytes answer 415)', async () => {
    const h = resumableSetup();
    try {
      const res1 = new FakeRes();
      await handlersCall(h.handlers, 'POST /videos/uploads', createReq('junk.bin', 50), res1);
      const { id } = res1.body as { id: string };
      await handlersCall(
        h.handlers,
        'PATCH /videos/uploads/:id',
        uploadReq(Buffer.alloc(50, 7), { 'x-upload-offset': '0' }, { id }),
        new FakeRes(),
      );
      const res2 = new FakeRes();
      await handlersCall(
        h.handlers,
        'POST /videos/uploads/:id/complete',
        fakeReq({ params: { id } }),
        res2,
      );
      expect(res2.statusCode).toBe(415);
    } finally {
      h.cleanup();
    }
  });

  it('gates every resumable route behind auth and 404s unknown sessions', async () => {
    const h = resumableSetup(DENY);
    try {
      for (const key of [
        'POST /videos/uploads',
        'GET /videos/uploads/:id',
        'PATCH /videos/uploads/:id',
        'POST /videos/uploads/:id/complete',
        'DELETE /videos/uploads/:id',
      ]) {
        const res = new FakeRes();
        await handlersCall(h.handlers, key, fakeReq({ params: { id: 'x' } }), res);
        expect(res.statusCode, key).toBe(401);
      }
    } finally {
      h.cleanup();
    }
    const open = resumableSetup();
    try {
      const res = new FakeRes();
      await handlersCall(
        open.handlers,
        'GET /videos/uploads/:id',
        fakeReq({ params: { id: 'nope' } }),
        res,
      );
      expect(res.statusCode).toBe(404);
      const res2 = new FakeRes();
      await handlersCall(
        open.handlers,
        'DELETE /videos/uploads/:id',
        fakeReq({ params: { id: 'nope' } }),
        res2,
      );
      expect(res2.statusCode).toBe(204); // discard is idempotent
    } finally {
      open.cleanup();
    }
  });
});

describe('registerUploadRoutes — throttling and error mapping', () => {
  it('applies the shared rate limit to session creation and one-shot uploads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-video-throttle-'));
    try {
      const resumable = new ResumableUploadStore(dir);
      const { router, handlers } = fakeRouter();
      let allowed = 1;
      registerUploadRoutes(router, () => makeStore(), ALLOW, {
        getResumable: () => resumable,
        throttle: (_req, res) => {
          if (allowed > 0) {
            allowed -= 1;
            return false;
          }
          res.status(429).json({ error: 'too many requests' });
          return true;
        },
      });
      const res1 = new FakeRes();
      await handlersCall(
        handlers,
        'POST /videos/uploads',
        fakeReq({ body: { name: 'a', size: 10 } as never }),
        res1,
      );
      expect(res1.statusCode).toBe(201);
      const res2 = new FakeRes();
      await handlersCall(
        handlers,
        'POST /videos/uploads',
        fakeReq({ body: { name: 'b', size: 10 } as never }),
        res2,
      );
      expect(res2.statusCode).toBe(429);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps an append overflow to 413 (same semantic as an oversize declaration)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-video-overflow-'));
    try {
      const resumable = new ResumableUploadStore(dir);
      const { router, handlers } = fakeRouter();
      registerUploadRoutes(router, () => makeStore(), ALLOW, { getResumable: () => resumable });
      const res1 = new FakeRes();
      await handlersCall(
        handlers,
        'POST /videos/uploads',
        fakeReq({ body: { name: 'a.mp4', size: 10 } as never }),
        res1,
      );
      const { id } = res1.body as { id: string };
      const res2 = new FakeRes();
      await handlersCall(
        handlers,
        'PATCH /videos/uploads/:id',
        uploadReq(Buffer.alloc(50, 1), { 'x-upload-offset': '0' }, { id }),
        res2,
      );
      expect(res2.statusCode).toBe(413);
      expect(res2.headers['Connection']).toBe('close'); // unread body → drop the connection after
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
