import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerSnapshotReadRoutes, type ISnapshotReadStore } from './snapshot-read-routes';
import type { ISnapshotMetadata } from './snapshot-service';

function meta(id: string, createdAt: number): ISnapshotMetadata {
  return {
    id,
    cameraId: 'bow',
    createdAt,
    contentType: 'image/jpeg',
    size: 100,
    telemetry: {
      position: null,
      headingTrue: null,
      speedOverGround: null,
      courseOverGroundTrue: null,
      depth: null,
      windSpeedApparent: null,
      windAngleApparent: null,
      oldestReadingAgeMs: null,
      positionAvailable: false,
    },
  };
}

function setup(over: Partial<ISnapshotReadStore> | null = {}) {
  const handlers: Record<string, (req: Request, res: Response) => void> = {};
  const router = {
    get: (p: string, h: (req: Request, res: Response) => void) => {
      handlers[`GET ${p}`] = h;
    },
    post() {},
    put() {},
    delete() {},
  } as unknown as IRouter;

  const store: ISnapshotReadStore | null = over && {
    list: () => [meta('a', 100), meta('b', 300), meta('c', 200)],
    get: (id: string) => (['a', 'b', 'c'].includes(id) ? meta(id, 100) : null),
    blobPath: (id: string) => `/data/snapshots/${id}.jpg`,
    ...over,
  };
  const stream = { on: vi.fn().mockReturnThis(), pipe: vi.fn() };
  const streamFactory = vi.fn(() => stream as never);
  registerSnapshotReadRoutes(router, () => store, { streamFactory });
  return { handlers, streamFactory, stream };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      res.headersSent = true;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    destroy: vi.fn(),
  };
  return res;
}
const fakeReq = (over: Partial<Request> = {}) => ({ params: {}, ...over }) as Request;

describe('registerSnapshotReadRoutes', () => {
  it('lists snapshots newest-first', () => {
    const { handlers } = setup();
    const res = makeRes();
    handlers['GET /snapshots'](fakeReq(), res as unknown as Response);
    const ids = (res.body as { snapshots: ISnapshotMetadata[] }).snapshots.map((s) => s.id);
    expect(ids).toEqual(['b', 'c', 'a']); // createdAt 300, 200, 100
  });

  it('serves a JPEG blob by id with the stored content type', () => {
    const { handlers, streamFactory, stream } = setup();
    const res = makeRes();
    handlers['GET /snapshots/:id'](
      fakeReq({ params: { id: 'b' } as never }),
      res as unknown as Response,
    );
    expect(res.headers['Content-Type']).toBe('image/jpeg');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(streamFactory).toHaveBeenCalledWith('/data/snapshots/b.jpg');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('400s an invalid id and never opens a stream', () => {
    const { handlers, streamFactory } = setup();
    const res = makeRes();
    handlers['GET /snapshots/:id'](
      fakeReq({ params: { id: '../etc/passwd' } as never }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(400);
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it('404s an unknown snapshot', () => {
    const { handlers } = setup();
    const res = makeRes();
    handlers['GET /snapshots/:id'](
      fakeReq({ params: { id: 'ghost' } as never }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(404);
  });

  it('503s until the plugin has started (no store)', () => {
    const { handlers } = setup(null);
    const res = makeRes();
    handlers['GET /snapshots'](fakeReq(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
  });
});
