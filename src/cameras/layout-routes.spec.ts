import { describe, it, expect } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerLayoutRoute } from './layout-routes';
import type { ICamera } from './camera-validation';

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => void>();
  const router = {
    get: (p: string, h: (req: Request, res: Response) => void) => handlers.set(`GET ${p}`, h),
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
const req = (): Request => ({}) as unknown as Request;

const cameras: Record<string, ICamera> = {
  bow: {
    name: 'Bow',
    enabled: true,
    source: { scheme: 'rtsp', host: 'c' },
    placement: { mount: 'bow' },
  },
};

describe('registerLayoutRoute', () => {
  it('returns the computed layout hints when started', () => {
    const { router, handlers } = fakeRouter();
    registerLayoutRoute(router, () => cameras);
    const res = new FakeRes();
    handlers.get('GET /cameras/layout')!(req(), res as unknown as Response);
    const body = res.body as { cameras: { id: string }[]; groups: { key: string }[] };
    expect(body.cameras.map((c) => c.id)).toEqual(['bow']);
    expect(body.groups.some((g) => g.key === 'all')).toBe(true);
  });

  it('returns 503 before the plugin has started', () => {
    const { router, handlers } = fakeRouter();
    registerLayoutRoute(router, () => null);
    const res = new FakeRes();
    handlers.get('GET /cameras/layout')!(req(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
  });
});
