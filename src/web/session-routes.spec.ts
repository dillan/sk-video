import { describe, it, expect } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { describeSession, registerSessionRoute } from './session-routes';
import type { ISecurityStrategy } from '../security/request-auth';

describe('describeSession', () => {
  it('reports an open server: security off, request allowed and writable', () => {
    expect(describeSession(undefined, {}, '1.2.3')).toEqual({
      securityEnabled: false,
      authenticated: true,
      readOnly: false,
      loggedIn: true,
      canWrite: true,
      anonymous: false,
      pluginVersion: '1.2.3',
    });
    expect(describeSession({ isDummy: () => true }, {}, '1.2.3').securityEnabled).toBe(false);
  });

  it('reports a secured server with an authenticated (writable) principal', () => {
    const strategy: ISecurityStrategy = { isDummy: () => false };
    expect(describeSession(strategy, { skPrincipal: { id: 'alice' } }, '1.2.3')).toEqual({
      securityEnabled: true,
      authenticated: true,
      readOnly: false,
      loggedIn: true,
      canWrite: true,
      anonymous: false,
      pluginVersion: '1.2.3',
    });
  });

  it('flags a logged-in read-only principal (write controls off, remedy = ask admin)', () => {
    const strategy: ISecurityStrategy = { isDummy: () => false };
    const session = describeSession(
      strategy,
      { skPrincipal: { identifier: 'guest', permissions: 'readonly' } },
      '1.2.3',
    );
    expect(session).toMatchObject({
      authenticated: true,
      readOnly: true,
      loggedIn: true,
      canWrite: false,
      anonymous: false,
    });
  });

  it('flags the anonymous AUTO readonly principal (allow_readonly, remedy = sign in)', () => {
    const strategy: ISecurityStrategy = { isDummy: () => false };
    const session = describeSession(
      strategy,
      { skPrincipal: { identifier: 'AUTO', permissions: 'readonly' } },
      '1.2.3',
    );
    expect(session).toMatchObject({
      readOnly: true,
      loggedIn: false,
      canWrite: false,
      anonymous: true,
    });
  });

  it('surfaces the identity (username + level) when the strategy exposes it', () => {
    const strategy: ISecurityStrategy = {
      isDummy: () => false,
      getLoginStatus: () => ({ status: 'loggedIn', username: 'skipper', userLevel: 'admin' }),
    };
    const session = describeSession(strategy, { skPrincipal: { identifier: 'skipper' } }, '1.2.3');
    expect(session).toMatchObject({
      loggedIn: true,
      canWrite: true,
      username: 'skipper',
      userLevel: 'admin',
    });
  });

  it('reports a secured server with an unauthenticated request', () => {
    const strategy: ISecurityStrategy = { isDummy: () => false };
    expect(describeSession(strategy, {}, '1.2.3')).toEqual({
      securityEnabled: true,
      authenticated: false,
      readOnly: false,
      loggedIn: false,
      canWrite: false,
      anonymous: false,
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
      readOnly: false,
      loggedIn: true,
      canWrite: true,
      anonymous: false,
      pluginVersion: '1.1.0',
    });
  });

  it('reflects an unauthenticated request on a secured server', () => {
    const call = setup({ securityStrategy: { isDummy: () => false }, pluginVersion: '1.1.0' });
    expect(call({})).toEqual({
      securityEnabled: true,
      authenticated: false,
      readOnly: false,
      loggedIn: false,
      canWrite: false,
      anonymous: false,
      pluginVersion: '1.1.0',
    });
  });
});
