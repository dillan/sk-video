import { describe, it, expect } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { describeSession, registerSessionRoute } from './session-routes';
import type { ISecurityStrategy } from '../security/request-auth';

describe('describeSession', () => {
  it('reports an open server: security off, request allowed', () => {
    expect(describeSession(undefined, {}, '1.2.3')).toEqual({
      securityEnabled: false,
      authenticated: true,
      pluginVersion: '1.2.3',
    });
    expect(describeSession({ isDummy: () => true }, {}, '1.2.3').securityEnabled).toBe(false);
  });

  it('reports a secured server with an authenticated principal', () => {
    const strategy: ISecurityStrategy = { isDummy: () => false };
    expect(describeSession(strategy, { skPrincipal: { id: 'alice' } }, '1.2.3')).toEqual({
      securityEnabled: true,
      authenticated: true,
      pluginVersion: '1.2.3',
    });
  });

  it('reports a secured server with an unauthenticated request', () => {
    const strategy: ISecurityStrategy = { isDummy: () => false };
    expect(describeSession(strategy, {}, '1.2.3')).toEqual({
      securityEnabled: true,
      authenticated: false,
      pluginVersion: '1.2.3',
    });
  });
});

describe('registerSessionRoute', () => {
  function setup(deps: { securityStrategy?: ISecurityStrategy; pluginVersion?: string } = {}) {
    let handler!: (req: Request, res: Response) => void;
    const router = {
      get: (path: string, h: (req: Request, res: Response) => void) => {
        if (path === '/session') handler = h;
      },
    } as unknown as IRouter;
    registerSessionRoute(router, {
      securityStrategy: deps.securityStrategy,
      pluginVersion: deps.pluginVersion ?? '0.0.0',
    });
    return (req: Partial<Request>) => {
      const res = {
        body: undefined as unknown,
        json(b: unknown) {
          this.body = b;
          return this;
        },
      };
      handler(req as Request, res as unknown as Response);
      return res.body;
    };
  }

  it('serves the session info as JSON (open server)', () => {
    const call = setup({ pluginVersion: '1.1.0' });
    expect(call({})).toEqual({
      securityEnabled: false,
      authenticated: true,
      pluginVersion: '1.1.0',
    });
  });

  it('reflects an unauthenticated request on a secured server', () => {
    const call = setup({ securityStrategy: { isDummy: () => false }, pluginVersion: '1.1.0' });
    expect(call({})).toEqual({
      securityEnabled: true,
      authenticated: false,
      pluginVersion: '1.1.0',
    });
  });
});
