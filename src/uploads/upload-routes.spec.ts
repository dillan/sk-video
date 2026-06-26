import { describe, it, expect } from 'vitest';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { IRouter, Request, Response } from 'express';
import { registerUploadRoutes } from './upload-routes';
import { AssetStore, type IAssetIndexPersistence, type IBlobStore } from './asset-store';

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

describe('registerUploadRoutes', () => {
  function setup(store = makeStore(), streamBytes = 100) {
    const { router, handlers } = fakeRouter();
    registerUploadRoutes(router, () => store, {
      streamFactory: (_path, opts) => {
        const full = Buffer.alloc(streamBytes, 1);
        const slice = opts ? full.subarray(opts.start, opts.end + 1) : full;
        return Readable.from(slice) as never;
      },
    });
    return { store, handlers };
  }

  it('stores a valid upload and returns 201 with the asset', async () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('POST /videos')!(
      fakeReq({ body: mp4(), headers: { 'x-filename': 'clip.mp4' } }),
      res as never,
    );
    await once(res, 'finish');
    expect(res.statusCode).toBe(201);
    expect((res.body as { contentType: string }).contentType).toBe('video/mp4');
  });

  it('rejects a non-video upload with 415', async () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('POST /videos')!(fakeReq({ body: Buffer.from('<html></html>') }), res as never);
    await once(res, 'finish');
    expect(res.statusCode).toBe(415);
  });

  it('rejects an over-quota upload with 413', async () => {
    const { handlers } = setup(makeStore({ maxFileBytes: 10, maxTotalBytes: 10, maxFileCount: 1 }));
    const res = new FakeRes();
    handlers.get('POST /videos')!(fakeReq({ body: mp4(100) }), res as never);
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
