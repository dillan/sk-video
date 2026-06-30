import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { registerPushRoutes, type IPushRouteDeps } from './push-routes';
import type { AuthGate } from '../security/request-auth';
import { PushStore } from './push-store';

const ALLOW: AuthGate = () => false;
const DENY: AuthGate = (_req, res) => {
  (res as unknown as { status(c: number): { json(p: unknown): void } })
    .status(401)
    .json({ error: 'authentication required' });
  return true;
};

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const add =
    (method: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => unknown>) =>
      handlers.set(`${method} ${path}`, rest[rest.length - 1]);
  return {
    router: { get: add('GET'), post: add('POST') } as never,
    handlers,
  };
}

function makeRes() {
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
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const VALID = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  keys: { p256dh: 'k', auth: 'a' },
};

function setup(over: Partial<IPushRouteDeps> = {}, gate: AuthGate = ALLOW) {
  const store = new PushStore();
  const deps: IPushRouteDeps = {
    getStore: () => store,
    vapidPublicKey: () => 'PUBLIC_KEY',
    ...over,
  };
  const { router, handlers } = fakeRouter();
  registerPushRoutes(router, deps, gate);
  return { handlers, store };
}

describe('push routes', () => {
  it('serves the VAPID public key (ungated — the browser needs it to subscribe)', () => {
    const { handlers } = setup();
    const res = makeRes();
    handlers.get('GET /push/vapid-public-key')!({} as Request, res);
    expect(res.body).toEqual({ key: 'PUBLIC_KEY' });
  });

  it('503s the key endpoint before push is configured', () => {
    const { handlers } = setup({ vapidPublicKey: () => null });
    const res = makeRes();
    handlers.get('GET /push/vapid-public-key')!({} as Request, res);
    expect(res.statusCode).toBe(503);
  });

  it('stores a valid subscription (201)', () => {
    const { handlers, store } = setup();
    const res = makeRes();
    handlers.get('POST /push/subscribe')!({ body: { subscription: VALID } } as Request, res);
    expect(res.statusCode).toBe(201);
    expect(store.list()).toHaveLength(1);
  });

  it('rejects a malformed subscription with 400 and stores nothing', () => {
    const { handlers, store } = setup();
    const res = makeRes();
    handlers.get('POST /push/subscribe')!(
      { body: { subscription: { endpoint: 'http://insecure' } } } as Request,
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(store.list()).toHaveLength(0);
  });

  it('gates subscribe (401 when unauthenticated) and stores nothing', () => {
    const { handlers, store } = setup({}, DENY);
    const res = makeRes();
    handlers.get('POST /push/subscribe')!({ body: { subscription: VALID } } as Request, res);
    expect(res.statusCode).toBe(401);
    expect(store.list()).toHaveLength(0);
  });

  it('unsubscribes by endpoint (204)', () => {
    const { handlers, store } = setup();
    store.add(VALID as never);
    const res = makeRes();
    handlers.get('POST /push/unsubscribe')!({ body: { endpoint: VALID.endpoint } } as Request, res);
    expect(res.statusCode).toBe(204);
    expect(store.list()).toHaveLength(0);
  });
});
