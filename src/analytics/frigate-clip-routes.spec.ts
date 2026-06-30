import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import type { IRouter, Request, Response } from 'express';
import { registerFrigateClipRoutes } from './frigate-clip-routes';
import type { AssetStore, IVideoAsset } from '../uploads/asset-store';

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => void>();
  const router = {
    get: (p: string, h: (req: Request, res: Response) => void) => handlers.set(`GET ${p}`, h),
  } as unknown as IRouter;
  return { router, handlers };
}
class FakeRes extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown;
  status(c: number): this {
    this.statusCode = c;
    return this;
  }
  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  json(p: unknown): this {
    this.body = p;
    this.end();
    return this;
  }
  get headersSent(): boolean {
    return false;
  }
  override _write(_c: Buffer, _e: string, cb: () => void): void {
    cb();
  }
}
const req = (over: Partial<Request> = {}): Request =>
  ({ params: {}, headers: {}, on: () => undefined, ...over }) as unknown as Request;

const asset: IVideoAsset = {
  id: 'clip-1',
  name: 'evt.mp4',
  contentType: 'video/mp4',
  size: 8,
  createdAt: 1,
};

function makeStore(over: Partial<AssetStore> = {}): AssetStore {
  return {
    list: () => [asset],
    get: (id: string) => (id === 'clip-1' ? asset : null),
    pathFor: (id: string) => `/data/frigate-clips/${id}`,
    ...over,
  } as unknown as AssetStore;
}

function setup(store: AssetStore | null = makeStore()) {
  const { router, handlers } = fakeRouter();
  registerFrigateClipRoutes(router, {
    getStore: () => store,
    streamFactory: (_p, opts) => {
      const full = Buffer.from('CLIPDATA');
      return Readable.from(opts ? full.subarray(opts.start, opts.end + 1) : full) as never;
    },
  });
  return handlers;
}

describe('registerFrigateClipRoutes', () => {
  it('lists cached clips', () => {
    const res = new FakeRes();
    setup().get('GET /frigate/clips')!(req(), res as unknown as Response);
    expect(res.body).toEqual({ clips: [asset] });
  });

  it('streams a clip with Range, nosniff', () => {
    const res = new FakeRes();
    setup().get('GET /frigate/clips/:id')!(
      req({ params: { id: 'clip-1' }, headers: { range: 'bytes=0-3' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-3/8');
    expect(res.headers['Content-Type']).toBe('video/mp4');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('400s an invalid id and 404s a missing clip', () => {
    const bad = new FakeRes();
    setup().get('GET /frigate/clips/:id')!(
      req({ params: { id: '../x' } }),
      bad as unknown as Response,
    );
    expect(bad.statusCode).toBe(400);
    const miss = new FakeRes();
    setup().get('GET /frigate/clips/:id')!(
      req({ params: { id: 'nope' } }),
      miss as unknown as Response,
    );
    expect(miss.statusCode).toBe(404);
  });

  it('503s before the plugin has started', () => {
    const res = new FakeRes();
    setup(null).get('GET /frigate/clips')!(req(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
  });
});
