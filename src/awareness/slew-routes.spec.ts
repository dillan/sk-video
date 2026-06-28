import { describe, it, expect } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerSlewRoutes, type ISlewRouteDeps } from './slew-routes';
import type { ICamera } from '../cameras/camera-validation';
import type { IAisTarget } from './ais-targets';
import type { ISlewOwnShip } from './slew-to-cue';
import type { ILatLon } from '../safety/mob-geo';

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => void>();
  const router = {
    post: (path: string, ...rest: Array<(req: Request, res: Response) => void>) =>
      handlers.set(`POST ${path}`, rest[rest.length - 1]),
    get: () => undefined,
  } as unknown as IRouter;
  return { router, handlers };
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
const req = (over: Partial<Request> = {}): Request =>
  ({ params: {}, headers: {}, ...over }) as unknown as Request;

const EARTH_RADIUS_M = 6_371_000;
const D2R = Math.PI / 180;
const ORIGIN: ILatLon = { latitude: 0, longitude: 0 };
const at = (eastM: number, northM: number): ILatLon => ({
  latitude: northM / (EARTH_RADIUS_M * D2R),
  longitude: eastM / (EARTH_RADIUS_M * D2R),
});

const CAL = { pan: { offset: 0, scalePerDeg: 0.01 }, tilt: { offset: 0, scalePerDeg: 0.01 } };
const ptzCamera = {
  name: 'Mast',
  enabled: true,
  source: { scheme: 'rtsp', host: 'cam' },
  capabilities: { absolutePtz: true },
  placement: { bearingRelativeDeg: 0 },
  calibration: CAL,
} as unknown as ICamera;
const own: ISlewOwnShip = { position: ORIGIN, headingDeg: 0, sogMps: 0, cogDeg: 0 };
const threat: IAisTarget = {
  id: 'cargo',
  mmsi: '123456789',
  name: 'Cargo',
  position: at(1000, 1000),
  sogMps: 4,
  cogDeg: 180,
};

function setup(over: Partial<ISlewRouteDeps> = {}) {
  const aimed: { id: string; pan: number; tilt: number }[] = [];
  const { router, handlers } = fakeRouter();
  const deps: ISlewRouteDeps = {
    ready: () => true,
    getCamera: (id) => (id === 'mast' ? ptzCamera : null),
    getOwnShip: () => own,
    getTargets: () => [threat],
    aimCamera: async (id, pan, tilt) => {
      aimed.push({ id, pan, tilt });
    },
    ...over,
  };
  registerSlewRoutes(router, deps);
  return { handler: handlers.get('POST /cameras/:id/slew-to-cue')!, aimed };
}
const flush = async (until: () => boolean): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (until()) return;
    await Promise.resolve();
  }
};

describe('registerSlewRoutes', () => {
  it('aims the camera at the nearest CPA target and returns its cue data', async () => {
    const { handler, aimed } = setup();
    const res = new FakeRes();
    handler(req({ params: { id: 'mast' } }), res as unknown as Response);
    await flush(() => res.body !== undefined);
    expect(aimed).toHaveLength(1);
    expect(aimed[0].id).toBe('mast');
    const body = res.body as { aimed: boolean; tracking: boolean; target: { mmsi: string } };
    expect(body).toMatchObject({ aimed: true, tracking: false });
    expect(body.target).toMatchObject({ id: 'cargo', mmsi: '123456789', name: 'Cargo' });
  });

  it('404s an unknown camera', () => {
    const { handler } = setup();
    const res = new FakeRes();
    handler(req({ params: { id: 'ghost' } }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
  });

  it('409s a camera without absolute PTZ or without calibration', () => {
    const noPtz = { ...ptzCamera, capabilities: { absolutePtz: false } } as ICamera;
    let r = new FakeRes();
    setup({ getCamera: () => noPtz }).handler(
      req({ params: { id: 'x' } }),
      r as unknown as Response,
    );
    expect(r.statusCode).toBe(409);

    const noCal = { ...ptzCamera, calibration: undefined } as ICamera;
    r = new FakeRes();
    setup({ getCamera: () => noCal }).handler(
      req({ params: { id: 'x' } }),
      r as unknown as Response,
    );
    expect(r.statusCode).toBe(409);
  });

  it('409s when there is no own-ship fix', () => {
    const { handler } = setup({ getOwnShip: () => null });
    const res = new FakeRes();
    handler(req({ params: { id: 'mast' } }), res as unknown as Response);
    expect(res.statusCode).toBe(409);
  });

  it('404s when no AIS target qualifies', () => {
    const { handler } = setup({ getTargets: () => [] });
    const res = new FakeRes();
    handler(req({ params: { id: 'mast' } }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
  });

  it('502s when the move fails, redacting the error', async () => {
    const { handler } = setup({
      aimCamera: async () => {
        throw new Error('connect rtsp://user:pass@cam failed');
      },
    });
    const res = new FakeRes();
    handler(req({ params: { id: 'mast' } }), res as unknown as Response);
    await flush(() => res.statusCode === 502);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('pass');
  });

  it('503s before the plugin is started', () => {
    const { handler } = setup({ ready: () => false });
    const res = new FakeRes();
    handler(req({ params: { id: 'mast' } }), res as unknown as Response);
    expect(res.statusCode).toBe(503);
  });
});
