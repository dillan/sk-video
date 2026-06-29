import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

/**
 * Authorisation gate for a plugin's own sensitive HTTP routes. Signal K enforces security at the
 * server, but a plugin route registered through `registerWithRouter` must still gate itself for
 * anything that could leak information to an unauthenticated caller. The Signal K security strategy is
 * NOT part of `@signalk/server-api`'s public types, so this feature-detects it structurally and fails
 * closed when security is on but the caller can't be shown to be logged in.
 *
 * Policy:
 *   - No strategy on the app → security isn't in play; allow.
 *   - Dummy strategy → the operator runs an open server by choice; allow (nothing to enforce).
 *   - Security enabled → allow only an authenticated request: one carrying `req.skPrincipal`, or one
 *     the strategy's own `getLoginStatus` reports as logged in. Anything else (including a thrown
 *     strategy) is denied.
 */

export interface ISecurityStrategy {
  /** True when the no-security ("dummy") strategy is active — i.e. the server runs fully open. */
  isDummy?: () => boolean;
  /** The strategy's view of a request's login state; shape varies by server version. */
  getLoginStatus?: (req: unknown) => { status?: string } | undefined;
}

export interface IAuthenticatableRequest {
  /** Set by the Signal K server on an authenticated request when security is enabled. */
  skPrincipal?: unknown;
}

/**
 * A route guard for a plugin's sensitive/mutating endpoints. Returns true — and has ALREADY sent a
 * `401` — when the caller is not authorized on a secured server; returns false (sending nothing) when
 * the caller may proceed. This is the shape of the `unauthorized(req, res)` helper wired in index.ts
 * from {@link isAuthorizedSensitiveRequest}; route modules accept one so every mutating handler can
 * fail closed the same way without each module re-deriving the security strategy. Express's `Request`
 * is imported as a type only, so this stays free of a runtime dependency on express.
 */
export type AuthGate = (req: ExpressRequest, res: ExpressResponse) => boolean;

/**
 * Whether the server is running with security enabled (a real strategy that isn't the open "dummy"
 * one). Used by the web app's session probe to decide whether to show sign-in UI. Fails to the safe
 * side: a strategy whose `isDummy` throws is treated as secured.
 */
export function isSecurityEnabled(strategy: ISecurityStrategy | undefined): boolean {
  if (!strategy) {
    return false;
  }
  try {
    return strategy.isDummy?.() !== true;
  } catch {
    return true;
  }
}

export function isAuthorizedSensitiveRequest(
  strategy: ISecurityStrategy | undefined,
  req: IAuthenticatableRequest,
): boolean {
  if (!strategy) {
    return true; // the server exposes no strategy → security is not configured
  }
  // An authenticated principal is always allowed, independent of the strategy's internals.
  if (req.skPrincipal !== undefined && req.skPrincipal !== null) {
    return true;
  }
  // Every call into the (untyped, version-varying) strategy is wrapped so ANY throw fails closed.
  try {
    if (strategy.isDummy?.() === true) {
      return true; // security explicitly disabled → open by the operator's choice
    }
    return strategy.getLoginStatus?.(req)?.status === 'loggedIn';
  } catch {
    return false; // fail closed on a misbehaving strategy
  }
}
