import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerRescanRoutes, type IRescanRouteDeps } from './rescan-routes';
import type { AuthGate } from '../security/request-auth';
import type { ICamera } from '../cameras/camera-validation';
import type { IIntrospectResult } from './onvif-introspect';

const ALLOW: AuthGate = () => false;
const DENY: AuthGate = (_req, res) => {
  res.status(401).json({ error: 'authentication required' });
  return true;
};

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const add =
    (m: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => unknown>) =>
      handlers.set(`${m} ${path}`, rest[rest.length - 1]);
  return { router: { get: add('GET'), post: add('POST') } as unknown as IRouter, handlers };
}
type ResMock = Response & { statusCode: number; body: unknown };
function makeRes(): ResMock {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(p: unknown) {
      this.body = p;
      return this;
    },
    end() {
      return this;
    },
  };
  return res as unknown as ResMock;
}
const fakeReq = (): Request => ({ params: { id: 'cam-1' } }) as unknown as Request;

const CAMERA: ICamera = {
  name: 'Foredeck',
  enabled: true,
  source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/main' },
};
const RESULT: IIntrospectResult = {
  ptz: true,
  absolutePtz: true,
  imaging: true,
  imagingControls: ['irCut'],
  audio: true,
  audioBackchannel: true,
  spotlight: false,
  alarm: false,
  auxCommands: [],
  firmwareVersion: 'v3.1.0',
};

function setup(over: Partial<IRescanRouteDeps> = {}, gate: AuthGate = ALLOW) {
  const introspect = vi.fn().mockResolvedValue(RESULT);
  const deps: IRescanRouteDeps = {
    ready: () => true,
    getCamera: () => CAMERA,
    getCredentials: () => ({ username: 'u', password: 'p' }),
    introspect,
    ...over,
  };
  const { router, handlers } = fakeRouter();
  registerRescanRoutes(router, deps, gate);
  return { handlers, introspect };
}
const invoke = async (h: (req: Request, res: Response) => unknown) => {
  const res = makeRes();
  await h(fakeReq(), res);
  return res;
};

describe('rescan route', () => {
  it('re-introspects with the stored credentials + host and returns the fresh discovery', async () => {
    const { handlers, introspect } = setup();
    const res = await invoke(handlers.get('POST /cameras/:id/rescan')!);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ firmwareVersion: 'v3.1.0', imaging: true });
    // RTSP source → ONVIF port is probed, not passed; stored creds are used.
    expect(introspect).toHaveBeenCalledWith({
      host: '192.168.1.100',
      port: undefined,
      username: 'u',
      password: 'p',
    });
  });

  it('passes the ONVIF port when the source itself is onvif://', async () => {
    const { handlers, introspect } = setup({
      getCamera: () => ({ ...CAMERA, source: { scheme: 'onvif', host: 'cam', port: 8000 } }),
    });
    await invoke(handlers.get('POST /cameras/:id/rescan')!);
    expect(introspect).toHaveBeenCalledWith(expect.objectContaining({ port: 8000 }));
  });

  it('404s for an unknown camera', async () => {
    const { handlers, introspect } = setup({ getCamera: () => null });
    const res = await invoke(handlers.get('POST /cameras/:id/rescan')!);
    expect(res.statusCode).toBe(404);
    expect(introspect).not.toHaveBeenCalled();
  });

  it('requires auth', async () => {
    const { handlers, introspect } = setup({}, DENY);
    const res = await invoke(handlers.get('POST /cameras/:id/rescan')!);
    expect(res.statusCode).toBe(401);
    expect(introspect).not.toHaveBeenCalled();
  });

  it('503s before the plugin has started', async () => {
    const { handlers } = setup({ ready: () => false });
    expect((await invoke(handlers.get('POST /cameras/:id/rescan')!)).statusCode).toBe(503);
  });

  it('maps an ONVIF failure to an actionable 502 hint', async () => {
    const { handlers } = setup({
      introspect: vi.fn().mockRejectedValue(new Error('Sender not authorized')),
    });
    const res = await invoke(handlers.get('POST /cameras/:id/rescan')!);
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ reason: 'auth' });
  });
});
