import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { registerConfigRoutes, type IConfigRouteDeps } from './config-routes';
import type { AuthGate } from '../security/request-auth';
import type { IOperationalConfig } from './operational-config';

const ALLOW: AuthGate = () => false;
const DENY: AuthGate = (_req, res) => {
  (res as unknown as { status(c: number): { json(p: unknown): void } })
    .status(401)
    .json({ error: 'auth' });
  return true;
};

function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const add =
    (m: string) =>
    (p: string, ...rest: Array<(req: Request, res: Response) => unknown>) =>
      handlers.set(`${m} ${p}`, rest[rest.length - 1]);
  return { router: { get: add('GET'), put: add('PUT') } as never, handlers };
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
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function setup(current: IOperationalConfig | null, gate: AuthGate = ALLOW) {
  const applied: IOperationalConfig[] = [];
  const deps: IConfigRouteDeps = {
    getConfig: () => current,
    applyConfig: (next) => applied.push(next),
  };
  const { router, handlers } = fakeRouter();
  registerConfigRoutes(router, deps, gate);
  return { handlers, applied };
}

describe('config routes', () => {
  it('GET returns the current config with the password redacted to a flag', () => {
    const { handlers } = setup({ frigate: { mqttHost: 'h', mqttPassword: 'secret' } });
    const res = makeRes();
    handlers.get('GET /operational-config')!({} as Request, res);
    const body = res.body as { frigate: { mqttHost: string; mqttPasswordSet: boolean } };
    expect(body.frigate.mqttHost).toBe('h');
    expect(body.frigate.mqttPasswordSet).toBe(true);
    expect((body.frigate as Record<string, unknown>).mqttPassword).toBeUndefined();
  });

  it('GET 503s before the plugin has started', () => {
    const { handlers } = setup(null);
    const res = makeRes();
    handlers.get('GET /operational-config')!({} as Request, res);
    expect(res.statusCode).toBe(503);
  });

  it('PUT validates, merges (preserving the password), and applies', () => {
    const { handlers, applied } = setup({ frigate: { mqttHost: 'old', mqttPassword: 'keep' } });
    const res = makeRes();
    handlers.get('PUT /operational-config')!(
      { body: { frigate: { mqttHost: 'new' } } } as Request,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as { restarting: boolean }).restarting).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0].frigate?.mqttHost).toBe('new');
    expect(applied[0].frigate?.mqttPassword).toBe('keep'); // preserved across the update
  });

  it('PUT rejects an invalid body with 400 and applies nothing', () => {
    const { handlers, applied } = setup({});
    const res = makeRes();
    handlers.get('PUT /operational-config')!(
      { body: { hardwareTier: 'nonsense' } } as Request,
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(applied).toHaveLength(0);
  });

  it('PUT is gated (401) and applies nothing when unauthenticated', () => {
    const { handlers, applied } = setup({}, DENY);
    const res = makeRes();
    handlers.get('PUT /operational-config')!({ body: {} } as Request, res);
    expect(res.statusCode).toBe(401);
    expect(applied).toHaveLength(0);
  });
});
