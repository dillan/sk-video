import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerAuxRoutes, type IAuxRouteDeps } from './aux-routes';
import type { AuthGate } from '../security/request-auth';
import { CameraNotFoundError, type PtzManager } from './ptz-manager';

const ALLOW: AuthGate = () => false;
const DENY: AuthGate = (_req, res) => {
  res.status(401).json({ error: 'authentication required' });
  return true;
};

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const add =
    (method: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => unknown>) =>
      handlers.set(`${method} ${path}`, rest[rest.length - 1]);
  const router = { get: add('GET'), post: add('POST') } as unknown as IRouter;
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
const fakeReq = (over: { params?: Record<string, string>; body?: unknown } = {}): Request =>
  ({ params: { id: 'cam-1' }, body: undefined, ...over }) as unknown as Request;

function setup(over: Partial<IAuxRouteDeps> = {}, gate: AuthGate = ALLOW) {
  const sendAux = vi.fn().mockResolvedValue(undefined);
  const controllerFor = vi.fn().mockResolvedValue({ sendAux });
  const manager = { controllerFor } as unknown as PtzManager;
  const deps: IAuxRouteDeps = {
    ready: () => true,
    getPtz: () => manager,
    getAuxCommands: () => ['tt:WhiteLight', 'tt:Siren'],
    ...over,
  };
  const { router, handlers } = fakeRouter();
  registerAuxRoutes(router, deps, gate);
  return { handlers, sendAux, controllerFor };
}
const invoke = async (h: (req: Request, res: Response) => unknown, req: Request) => {
  const res = makeRes();
  await h(req, res);
  return res;
};

describe('aux routes (spotlight / alarm)', () => {
  it('sends the On aux command for the resolved fixture', async () => {
    const { handlers, sendAux } = setup();
    const res = await invoke(
      handlers.get('POST /cameras/:id/spotlight')!,
      fakeReq({ body: { on: true } }),
    );
    expect(res.statusCode).toBe(204);
    expect(sendAux).toHaveBeenCalledWith('tt:WhiteLight|On');
  });

  it('defaults to Off — only an explicit on:true fires the fixture (safe for the siren)', async () => {
    const { handlers, sendAux } = setup();
    await invoke(handlers.get('POST /cameras/:id/alarm')!, fakeReq({ body: {} }));
    expect(sendAux).toHaveBeenCalledWith('tt:Siren|Off');
  });

  it('turns the alarm on with on:true', async () => {
    const { handlers, sendAux } = setup();
    await invoke(handlers.get('POST /cameras/:id/alarm')!, fakeReq({ body: { on: true } }));
    expect(sendAux).toHaveBeenCalledWith('tt:Siren|On');
  });

  it('404s when the camera advertised no matching aux command', async () => {
    const { handlers, sendAux } = setup({ getAuxCommands: () => ['tt:Wiper'] });
    const res = await invoke(
      handlers.get('POST /cameras/:id/spotlight')!,
      fakeReq({ body: { on: true } }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: 'camera has no spotlight control' });
    expect(sendAux).not.toHaveBeenCalled();
  });

  it('404s for an unknown camera', async () => {
    const { handlers } = setup({ getAuxCommands: () => null });
    const res = await invoke(
      handlers.get('POST /cameras/:id/spotlight')!,
      fakeReq({ body: { on: true } }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: 'unknown camera' });
  });

  it('requires auth (the gate rejects)', async () => {
    const { handlers, sendAux } = setup({}, DENY);
    const res = await invoke(
      handlers.get('POST /cameras/:id/spotlight')!,
      fakeReq({ body: { on: true } }),
    );
    expect(res.statusCode).toBe(401);
    expect(sendAux).not.toHaveBeenCalled();
  });

  it('503s before the plugin has started', async () => {
    const { handlers } = setup({ ready: () => false });
    const res = await invoke(
      handlers.get('POST /cameras/:id/alarm')!,
      fakeReq({ body: { on: true } }),
    );
    expect(res.statusCode).toBe(503);
  });

  it('maps an ONVIF failure to an actionable 502 hint', async () => {
    const controllerFor = vi.fn().mockResolvedValue({
      sendAux: vi.fn().mockRejectedValue(new Error('Wrong ONVIF SOAP response')),
    });
    const { handlers } = setup({ getPtz: () => ({ controllerFor }) as unknown as PtzManager });
    const res = await invoke(
      handlers.get('POST /cameras/:id/spotlight')!,
      fakeReq({ body: { on: true } }),
    );
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ reason: 'onvif' });
  });

  it('404s when the controller reports an unknown camera', async () => {
    const controllerFor = vi.fn().mockRejectedValue(new CameraNotFoundError('nope'));
    const { handlers } = setup({ getPtz: () => ({ controllerFor }) as unknown as PtzManager });
    const res = await invoke(
      handlers.get('POST /cameras/:id/alarm')!,
      fakeReq({ body: { on: true } }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: 'unknown camera' });
  });
});
