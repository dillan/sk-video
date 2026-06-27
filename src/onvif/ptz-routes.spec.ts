import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerPtzRoutes } from './ptz-routes';
import { CameraNotFoundError, type PtzManager } from './ptz-manager';

/** A router that captures handlers keyed by "METHOD path" so each route can be invoked directly. */
function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const add =
    (method: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => unknown>) =>
      handlers.set(`${method} ${path}`, rest[rest.length - 1]);
  const router = {
    get: add('GET'),
    post: add('POST'),
  } as unknown as IRouter;
  return { router, handlers };
}

type ResMock = Response & { statusCode: number; body: unknown; ended: boolean };

function makeRes(): ResMock {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res as unknown as ResMock;
}

function fakeReq(over: { params?: Record<string, string>; body?: unknown } = {}): Request {
  return { params: { id: 'cam-1' }, body: undefined, ...over } as unknown as Request;
}

/** A fake ONVIF controller matching the OnvifPtzController surface the routes touch. */
function makeController() {
  return {
    move: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    getPresets: vi.fn().mockResolvedValue([{ token: 'p1', name: 'Dock' }]),
    gotoPreset: vi.fn(),
  };
}

function makeManager(controller: ReturnType<typeof makeController>) {
  return {
    controllerFor: vi.fn().mockResolvedValue(controller),
  } as unknown as PtzManager & {
    controllerFor: ReturnType<typeof vi.fn>;
  };
}

/** Registers the routes against a live manager (or null) and returns the handler map. */
function setup(getPtz: () => PtzManager | null) {
  const { router, handlers } = fakeRouter();
  registerPtzRoutes(router, getPtz);
  return handlers;
}

/** Invokes a captured handler, awaiting the returned promise, and returns the response mock. */
async function invoke(
  handler: (req: Request, res: Response) => unknown,
  req: Request = fakeReq(),
): Promise<ResMock> {
  const res = makeRes();
  await handler(req, res as unknown as Response);
  return res;
}

const ROUTE_KEYS = [
  'POST /cameras/:id/ptz',
  'POST /cameras/:id/ptz/stop',
  'GET /cameras/:id/ptz/presets',
  'POST /cameras/:id/ptz/preset',
] as const;

describe('registerPtzRoutes', () => {
  it('registers exactly the four expected routes', () => {
    const handlers = setup(() => makeManager(makeController()));
    expect([...handlers.keys()].sort()).toEqual([...ROUTE_KEYS].sort());
  });

  it('returns 503 "plugin not started" from every route when the manager is null', async () => {
    const handlers = setup(() => null);
    for (const key of ROUTE_KEYS) {
      const res = await invoke(handlers.get(key)!);
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: 'plugin not started' });
    }
  });

  it('forwards the request body {pan,tilt,zoom} to controller.move and returns 204', async () => {
    const controller = makeController();
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(
      handlers.get('POST /cameras/:id/ptz')!,
      fakeReq({ body: { pan: 0.5, tilt: -0.25, zoom: 1 } }),
    );
    expect(controller.move).toHaveBeenCalledWith({ pan: 0.5, tilt: -0.25, zoom: 1 });
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('passes the (stringified) camera id from req.params.id to controllerFor', async () => {
    const controller = makeController();
    const manager = makeManager(controller);
    const handlers = setup(() => manager);
    await invoke(
      handlers.get('POST /cameras/:id/ptz')!,
      fakeReq({ params: { id: 'front-deck' }, body: {} }),
    );
    expect(manager.controllerFor).toHaveBeenCalledWith('front-deck');
  });

  it('calls controller.stop and returns 204', async () => {
    const controller = makeController();
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(handlers.get('POST /cameras/:id/ptz/stop')!);
    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('returns 200 with the preset list from getPresets', async () => {
    const controller = makeController();
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(handlers.get('GET /cameras/:id/ptz/presets')!);
    expect(controller.getPresets).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ token: 'p1', name: 'Dock' }]);
  });

  it('forwards the preset token to gotoPreset and returns 204', async () => {
    const controller = makeController();
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(
      handlers.get('POST /cameras/:id/ptz/preset')!,
      fakeReq({ body: { token: 'token-7' } }),
    );
    expect(controller.gotoPreset).toHaveBeenCalledWith('token-7');
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('defaults the preset token to an empty string when the body has no token', async () => {
    const controller = makeController();
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(handlers.get('POST /cameras/:id/ptz/preset')!, fakeReq({ body: {} }));
    expect(controller.gotoPreset).toHaveBeenCalledWith('');
    expect(res.statusCode).toBe(204);
  });

  it('defaults the preset token to an empty string when there is no body at all', async () => {
    const controller = makeController();
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(
      handlers.get('POST /cameras/:id/ptz/preset')!,
      fakeReq({ body: undefined }),
    );
    expect(controller.gotoPreset).toHaveBeenCalledWith('');
    expect(res.statusCode).toBe(204);
  });

  it('stringifies a non-string preset token before forwarding it', async () => {
    const controller = makeController();
    const handlers = setup(() => makeManager(controller));
    await invoke(handlers.get('POST /cameras/:id/ptz/preset')!, fakeReq({ body: { token: 42 } }));
    expect(controller.gotoPreset).toHaveBeenCalledWith('42');
  });

  it('returns 404 "unknown camera" when controllerFor throws CameraNotFoundError (move)', async () => {
    const manager = {
      controllerFor: vi.fn().mockRejectedValue(new CameraNotFoundError('unknown camera cam-1')),
    } as unknown as PtzManager;
    const handlers = setup(() => manager);
    const res = await invoke(handlers.get('POST /cameras/:id/ptz')!, fakeReq({ body: {} }));
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'unknown camera' });
  });

  it('returns 404 "unknown camera" when controllerFor throws CameraNotFoundError (presets)', async () => {
    const manager = {
      controllerFor: vi.fn().mockRejectedValue(new CameraNotFoundError('unknown camera cam-1')),
    } as unknown as PtzManager;
    const handlers = setup(() => manager);
    const res = await invoke(handlers.get('GET /cameras/:id/ptz/presets')!);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'unknown camera' });
  });

  it('returns 404 "unknown camera" when controllerFor throws CameraNotFoundError (stop)', async () => {
    const manager = {
      controllerFor: vi.fn().mockRejectedValue(new CameraNotFoundError('unknown camera cam-1')),
    } as unknown as PtzManager;
    const handlers = setup(() => manager);
    const res = await invoke(handlers.get('POST /cameras/:id/ptz/stop')!);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'unknown camera' });
  });

  it('returns 404 "unknown camera" when controllerFor throws CameraNotFoundError (preset)', async () => {
    const manager = {
      controllerFor: vi.fn().mockRejectedValue(new CameraNotFoundError('unknown camera cam-1')),
    } as unknown as PtzManager;
    const handlers = setup(() => manager);
    const res = await invoke(
      handlers.get('POST /cameras/:id/ptz/preset')!,
      fakeReq({ body: { token: 'p1' } }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'unknown camera' });
  });

  it('returns 502 with the error message when controllerFor throws a generic Error', async () => {
    const manager = {
      controllerFor: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as PtzManager;
    const handlers = setup(() => manager);
    const res = await invoke(handlers.get('POST /cameras/:id/ptz/stop')!);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'boom' });
  });

  it('returns 502 with the message when controller.move rejects', async () => {
    const controller = makeController();
    controller.move.mockRejectedValue(new Error('camera offline'));
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(handlers.get('POST /cameras/:id/ptz')!, fakeReq({ body: {} }));
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'camera offline' });
  });

  it('redacts a credential URL in a 502 error message before returning it to the client', async () => {
    const controller = makeController();
    controller.move.mockRejectedValue(
      new Error('connect rtsp://admin:secret@cam.local:554 failed'),
    );
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(handlers.get('POST /cameras/:id/ptz')!, fakeReq({ body: {} }));
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'connect rtsp://***@cam.local:554 failed' });
  });

  it('returns 502 with the message when controller.gotoPreset rejects', async () => {
    const controller = makeController();
    controller.gotoPreset.mockRejectedValue(new Error('invalid preset token'));
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(
      handlers.get('POST /cameras/:id/ptz/preset')!,
      fakeReq({ body: { token: '<bad>' } }),
    );
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'invalid preset token' });
  });

  it('returns 502 with the message when controller.stop rejects', async () => {
    const controller = makeController();
    controller.stop.mockRejectedValue(new Error('stop failed'));
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(handlers.get('POST /cameras/:id/ptz/stop')!);
    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'stop failed' });
  });

  it('returns 502 with the message when controller.getPresets rejects', async () => {
    const controller = makeController();
    controller.getPresets.mockRejectedValue(new Error('presets unavailable'));
    const handlers = setup(() => makeManager(controller));
    const res = await invoke(handlers.get('GET /cameras/:id/ptz/presets')!);
    expect(controller.getPresets).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'presets unavailable' });
  });

  it('reports a non-Error rejection as 502 with a fallback message', async () => {
    const manager = {
      controllerFor: vi.fn().mockRejectedValue('totally not an error'),
    } as unknown as PtzManager;
    const handlers = setup(() => manager);
    const res = await invoke(handlers.get('POST /cameras/:id/ptz/stop')!);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'PTZ command failed' });
  });
});
