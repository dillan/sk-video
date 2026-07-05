import type { IRouter, Request, Response } from 'express';
import {
  isAnonymousPrincipal,
  isAuthorizedSensitiveRequest,
  isLoggedInPrincipal,
  isReadOnlyPrincipal,
  isSecurityEnabled,
  canWriteRequest,
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
  /** The principal is KNOWN read-only — the app disables write controls. Unknown shapes read false. */
  readOnly: boolean;
  /**
   * A REAL authenticated principal (a login), not the anonymous `AUTO` readonly principal an
   * `allow_readonly` server attaches. Lets the app pick the right remedy for "can't write":
   * loggedIn + !canWrite → ask an admin; !loggedIn → sign in.
   */
  loggedIn: boolean;
  /** The single flag the app gates write controls on. Open server ⇒ true; known-readonly ⇒ false. */
  canWrite: boolean;
  /** The anonymous `AUTO` readonly principal reached this route (an `allow_readonly` open-read). */
  anonymous: boolean;
  /** The signed-in user's name, when the server exposes it — for the quiet identity indicator. */
  username?: string;
  /** The signed-in user's level ('admin' | 'readwrite' | 'readonly'), when the server exposes it. */
  userLevel?: string;
  /** The plugin's version, so the app can detect a stale shell after a redeploy. */
  pluginVersion: string;
}

export function describeSession(
  strategy: ISecurityStrategy | undefined,
  req: IAuthenticatableRequest,
  pluginVersion: string,
): ISessionInfo {
  const info: ISessionInfo = {
    securityEnabled: isSecurityEnabled(strategy),
    authenticated: isAuthorizedSensitiveRequest(strategy, req),
    readOnly: isReadOnlyPrincipal(req),
    loggedIn: isLoggedInPrincipal(strategy, req),
    canWrite: canWriteRequest(strategy, req),
    anonymous: isAnonymousPrincipal(strategy, req),
    pluginVersion,
  };
  // Best-effort identity — never load-bearing, so a throwing/older strategy just omits it.
  try {
    const status = strategy?.getLoginStatus?.(req);
    if (typeof status?.username === 'string') info.username = status.username;
    if (typeof status?.userLevel === 'string') info.userLevel = status.userLevel;
  } catch {
    // ignore — the app treats username/userLevel as optional
  }
  return info;
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
