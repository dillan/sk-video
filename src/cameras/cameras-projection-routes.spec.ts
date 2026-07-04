import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerCamerasProjectionRoute } from './cameras-projection-routes';
import type { ICamera } from './camera-validation';

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const add =
    (method: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => unknown>) =>
      handlers.set(`${method} ${path}`, rest[rest.length - 1]);
  const router = { get: add('GET'), post: add('POST') } as unknown as IRouter;
  return { router, handlers };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  };
}

const CAMS: Record<string, ICamera> = {
  foredeck: {
    name: 'Foredeck',
    enabled: true,
    source: { scheme: 'rtsp', host: '10.0.0.2', path: '/main' },
    role: 'navigation',
    placement: { mount: 'mast', bearingRelativeDeg: 0 },
    capabilities: { ptz: true, substreams: true },
    media: { codec: 'h265', substreamPath: '/sub' },
  },
  stern: {
    name: 'Stern',
    enabled: true,
    source: { scheme: 'rtsp', host: '10.0.0.3', path: '/main' },
  },
};

const HEALTHS = {
  foredeck: { online: true, producers: 1, consumers: 0, codecs: ['H265'], sources: [] },
  stern: { online: false, producers: 0, consumers: 0, codecs: [], sources: [] },
};

function setup(over: Partial<Parameters<typeof registerCamerasProjectionRoute>[1]> = {}) {
  const deps = {
    listCameras: () => CAMS,
    fetchAllHealth: vi.fn(async () => HEALTHS),
    lastGood: (id: string) => ({
      lastGoodAt: id === 'stern' ? 500 : 900,
      trackedSince: 100,
    }),
    ...over,
  };
  const { router, handlers } = fakeRouter();
  registerCamerasProjectionRoute(router, deps);
  return { handlers, deps };
}

describe('GET /cameras (aggregate projection)', () => {
  it('returns defs + health(+last-good) + transport + layout in one response, without sources', async () => {
    const { handlers } = setup();
    const res = makeRes();
    await handlers.get('GET /cameras')!({} as Request, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      gatewayOnline: boolean;
      cameras: Array<Record<string, unknown>>;
      layout: { groups: Array<{ key: string }> };
    };
    expect(body.gatewayOnline).toBe(true);
    expect(body.cameras).toHaveLength(2);
    const foredeck = body.cameras.find((c) => c.id === 'foredeck')!;
    expect(foredeck).toMatchObject({
      name: 'Foredeck',
      enabled: true,
      role: 'navigation',
      health: { online: true, lastGoodAt: 900, trackedSince: 100 },
    });
    // The transport walk is computed server-side from the negotiated codecs (H.265 → HLS first).
    expect((foredeck.transport as { recommended: string[] }).recommended[0]).not.toBe('webrtc');
    // The wall never needs the camera's network source; the projection must not carry it.
    expect(foredeck.source).toBeUndefined();
    expect(body.layout.groups.length).toBeGreaterThan(0);
  });

  it('still serves defs (health/transport null) when the gateway is down', async () => {
    const { handlers } = setup({
      fetchAllHealth: vi.fn(async () => {
        throw new Error('gateway unavailable');
      }),
    });
    const res = makeRes();
    await handlers.get('GET /cameras')!({} as Request, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { gatewayOnline: boolean; cameras: Array<Record<string, unknown>> };
    expect(body.gatewayOnline).toBe(false);
    expect(body.cameras[0].health).toBeNull();
    expect(body.cameras[0].transport).toBeNull();
  });

  it('503s before the camera store is ready', async () => {
    const { handlers } = setup({ listCameras: () => null });
    const res = makeRes();
    await handlers.get('GET /cameras')!({} as Request, res);
    expect(res.statusCode).toBe(503);
  });

  it('carries a per-camera capability manifest derived from the stored definition', async () => {
    const { handlers } = setup();
    const res = makeRes();
    await handlers.get('GET /cameras')!({} as Request, res);
    const body = res.body as { cameras: Array<Record<string, unknown>> };
    const foredeck = body.cameras.find((c) => c.id === 'foredeck')!;
    const manifest = foredeck.manifest as {
      supportedFeatures: string[];
      controls: { id: string }[];
      streams: Record<string, string>;
    };
    expect(manifest.supportedFeatures).toContain('ptz');
    expect(manifest.streams.hls).toBe('/plugins/sk-video/cameras/foredeck/stream.m3u8');
    expect(manifest.controls.some((c) => c.id === 'activePreset')).toBe(true);
    // The manifest is projection-only, source-free like everything else here.
    expect(JSON.stringify(manifest)).not.toContain('10.0.0.');
  });

  it('marks live state uncacheable (device state can change at any time)', async () => {
    const { handlers } = setup();
    const res = makeRes();
    await handlers.get('GET /cameras')!({} as Request, res);
    expect(res.headers['Cache-Control']).toBe('no-cache');
  });
});
