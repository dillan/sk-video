import { describe, it, expect } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerImagingRoutes, type IImagingRouteDeps } from './imaging-routes';
import type { IImagingSettings, IImagingUpdate } from './onvif-controller';

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => void>();
  const add =
    (m: string) =>
    (p: string, ...rest: Array<(req: Request, res: Response) => void>) =>
      handlers.set(`${m} ${p}`, rest[rest.length - 1]);
  return { router: { get: add('GET'), post: add('POST') } as unknown as IRouter, handlers };
}
class FakeRes {
  statusCode = 200;
  body: unknown;
  status(c: number): this {
    this.statusCode = c;
    return this;
  }
  json(p: unknown): this {
    this.body = p;
    return this;
  }
}
const req = (over: Partial<Request> & { body?: unknown } = {}): Request =>
  ({ params: {}, headers: {}, ...over }) as unknown as Request;
const flush = async (until: () => boolean): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (until()) return;
    await Promise.resolve();
  }
};

const CURRENT: IImagingSettings = {
  brightness: 50,
  colorSaturation: 60,
  irCutFilter: 'AUTO',
};

function setup(over: Partial<IImagingRouteDeps> = {}) {
  const writes: { id: string; update: IImagingUpdate }[] = [];
  const { router, handlers } = fakeRouter();
  const deps: IImagingRouteDeps = {
    ready: () => true,
    hasCamera: (id) => id === 'bow',
    getImaging: async () => CURRENT,
    setImaging: async (id, update) => {
      writes.push({ id, update });
    },
    ...over,
  };
  registerImagingRoutes(router, deps);
  return { handlers, writes };
}

describe('GET /cameras/:id/imaging', () => {
  it('returns the current settings plus the controls/presets the camera can act on', async () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('GET /cameras/:id/imaging')!(
      req({ params: { id: 'bow' } }),
      res as unknown as Response,
    );
    await flush(() => res.body !== undefined);
    const body = res.body as { settings: IImagingSettings; controls: string[]; presets: string[] };
    expect(body.settings).toEqual(CURRENT);
    expect(body.controls).toContain('irCut');
    expect(body.presets).toContain('night');
  });

  it('404s an unknown camera and 502s an imaging read failure (redacted)', async () => {
    const r1 = new FakeRes();
    setup().handlers.get('GET /cameras/:id/imaging')!(
      req({ params: { id: 'ghost' } }),
      r1 as unknown as Response,
    );
    expect(r1.statusCode).toBe(404);

    const r2 = new FakeRes();
    setup({
      getImaging: async () => {
        throw new Error('connect rtsp://user:pass@cam failed');
      },
    }).handlers.get('GET /cameras/:id/imaging')!(
      req({ params: { id: 'bow' } }),
      r2 as unknown as Response,
    );
    await flush(() => r2.statusCode === 502);
    expect(r2.statusCode).toBe(502);
    expect(JSON.stringify(r2.body)).not.toContain('pass');
  });
});

describe('POST /cameras/:id/imaging/preset', () => {
  it('reads current, computes a gated relative update, and writes it', async () => {
    const { handlers, writes } = setup();
    const res = new FakeRes();
    handlers.get('POST /cameras/:id/imaging/preset')!(
      req({ params: { id: 'bow' }, body: { preset: 'night' } }),
      res as unknown as Response,
    );
    await flush(() => res.body !== undefined);
    expect(writes).toHaveLength(1);
    expect(writes[0].update.irCutFilter).toBe('OFF');
    expect(writes[0].update.brightness).toBeCloseTo(62.5, 5);
    expect((res.body as { preset: string }).preset).toBe('night');
  });

  it('400s an unknown preset', () => {
    const { handlers, writes } = setup();
    const res = new FakeRes();
    handlers.get('POST /cameras/:id/imaging/preset')!(
      req({ params: { id: 'bow' }, body: { preset: 'disco' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('409s when the camera exposes none of the preset levers', async () => {
    const { handlers } = setup({ getImaging: async () => ({}) }); // no controls at all
    const res = new FakeRes();
    handlers.get('POST /cameras/:id/imaging/preset')!(
      req({ params: { id: 'bow' }, body: { preset: 'night' } }),
      res as unknown as Response,
    );
    await flush(() => res.statusCode !== 200);
    expect(res.statusCode).toBe(409);
  });

  it('502s a write failure (redacted) and 503s before start', async () => {
    const r1 = new FakeRes();
    setup({
      setImaging: async () => {
        throw new Error('rtsp://user:secret@cam refused');
      },
    }).handlers.get('POST /cameras/:id/imaging/preset')!(
      req({ params: { id: 'bow' }, body: { preset: 'day' } }),
      r1 as unknown as Response,
    );
    await flush(() => r1.statusCode === 502);
    expect(r1.statusCode).toBe(502);
    expect(JSON.stringify(r1.body)).not.toContain('secret');

    const r2 = new FakeRes();
    setup({ ready: () => false }).handlers.get('POST /cameras/:id/imaging/preset')!(
      req({ params: { id: 'bow' }, body: { preset: 'day' } }),
      r2 as unknown as Response,
    );
    expect(r2.statusCode).toBe(503);
  });
});
