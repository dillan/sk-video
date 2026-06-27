import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerIntrospectRoute, type IIntrospectRouteContext } from './introspect-routes';
import type { IIntrospectResult } from '../onvif/onvif-introspect';

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  };
}

const RESULT: IIntrospectResult = {
  manufacturer: 'Acme',
  model: 'Dome',
  source: { scheme: 'rtsp', host: '192.168.1.50', port: 554, path: '/s1' },
  snapshotUri: 'http://192.168.1.50/snap.jpg',
  ptz: true,
  absolutePtz: true,
  imaging: true,
  imagingControls: ['irCut'],
  audio: false,
};

function setup(over: Partial<IIntrospectRouteContext> = {}) {
  const ctx: IIntrospectRouteContext = {
    ready: () => true,
    assertHostAllowed: vi.fn().mockResolvedValue(undefined),
    introspect: vi.fn().mockResolvedValue(RESULT),
    ...over,
  };
  let captured!: (req: Request, res: Response) => unknown;
  const router = {
    post: (_p: string, h: (req: Request, res: Response) => unknown) => {
      captured = h;
    },
  } as unknown as IRouter;
  registerIntrospectRoute(router, ctx);
  const call = async (body: unknown) => {
    const res = makeRes();
    await captured({ body } as Request, res);
    return res;
  };
  return { ctx, call };
}

describe('registerIntrospectRoute', () => {
  it('introspects a host and returns the pre-filled fields', async () => {
    const { ctx, call } = setup();
    const res = await call({ host: '192.168.1.50', port: 8000, username: 'admin', password: 'p' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(RESULT);
    expect(ctx.introspect).toHaveBeenCalledWith({
      host: '192.168.1.50',
      port: 8000,
      username: 'admin',
      password: 'p',
    });
  });

  it('returns 400 for a missing/invalid host or bad port and never introspects', async () => {
    const { ctx, call } = setup();
    expect((await call({})).statusCode).toBe(400);
    expect((await call({ host: 'bad host!' })).statusCode).toBe(400);
    expect((await call({ host: '10.0.0.5', port: 0 })).statusCode).toBe(400);
    expect(ctx.introspect).not.toHaveBeenCalled();
  });

  it('returns 403 when the SSRF guard blocks the host and never introspects', async () => {
    const { ctx, call } = setup({
      assertHostAllowed: vi.fn().mockRejectedValue(new Error('blocked')),
    });
    const res = await call({ host: '169.254.169.254' });
    expect(res.statusCode).toBe(403);
    expect(ctx.introspect).not.toHaveBeenCalled();
  });

  it('returns 502 when introspection throws', async () => {
    const { call } = setup({ introspect: vi.fn().mockRejectedValue(new Error('unreachable')) });
    expect((await call({ host: '10.0.0.5' })).statusCode).toBe(502);
  });

  it('returns 429 when rate-limited, before doing anything', async () => {
    const { ctx, call } = setup({ rateLimit: () => ({ ok: false, retryAfterMs: 3000 }) });
    const res = await call({ host: '10.0.0.5' });
    expect(res.statusCode).toBe(429);
    expect(ctx.assertHostAllowed).not.toHaveBeenCalled();
    expect(ctx.introspect).not.toHaveBeenCalled();
  });

  it('returns 503 before the plugin has started', async () => {
    const { call } = setup({ ready: () => false });
    expect((await call({ host: '10.0.0.5' })).statusCode).toBe(503);
  });
});
