import type { IRouter, Request, Response } from 'express';
import {
  isAuthorizedSensitiveRequest,
  isSecurityEnabled,
  type IAuthenticatableRequest,
  type ISecurityStrategy,
} from '../security/request-auth';

/**
 * `GET /plugins/sk-video/session` — an auth-only "whoami" the web app calls on connect (and on tab
 * foreground / after a 401) to learn, in one round-trip, whether the server has security enabled and
 * whether THIS request is authenticated. It returns booleans only — never a token or principal secret —
 * so it is safe to leave open: the app uses it to decide whether to show sign-in UI and to gate
 * write actions, while tier/capabilities stay sourced from `GET /status` (one source of truth).
 */

export interface ISessionInfo {
  /** Server has a real security strategy (not the open "dummy" one). */
  securityEnabled: boolean;
  /** This request is allowed to perform sensitive actions (always true on an open server). */
  authenticated: boolean;
  /** The plugin's version, so the app can detect a stale shell after a redeploy. */
  pluginVersion: string;
}

export function describeSession(
  strategy: ISecurityStrategy | undefined,
  req: IAuthenticatableRequest,
  pluginVersion: string,
): ISessionInfo {
  return {
    securityEnabled: isSecurityEnabled(strategy),
    authenticated: isAuthorizedSensitiveRequest(strategy, req),
    pluginVersion,
  };
}

export interface ISessionRouteDeps {
  securityStrategy: ISecurityStrategy | undefined;
  pluginVersion: string;
}

export function registerSessionRoute(router: IRouter, deps: ISessionRouteDeps): void {
  router.get('/session', (req: Request, res: Response) => {
    res.json(
      describeSession(deps.securityStrategy, req as IAuthenticatableRequest, deps.pluginVersion),
    );
  });
}
