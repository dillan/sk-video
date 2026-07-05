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
  /**
   * The strategy's view of a request's login state; shape varies by server version. `status` is
   * `'loggedIn'` only for a REAL authenticated principal (never the anonymous `AUTO` readonly one),
   * and `username`/`userLevel` are present only in that case — which is how we tell a signed-in
   * read-only user (remedy: ask an admin) from an anonymous or lapsed one (remedy: sign in).
   */
  getLoginStatus?: (req: unknown) =>
    | {
        status?: string;
        username?: string;
        userLevel?: string;
        readOnlyAccess?: boolean;
        authenticationRequired?: boolean;
      }
    | undefined;
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

/**
 * The principal's coarse permission level ('readonly' | 'readwrite' | 'admin') when the server
 * exposes one on the request, else null. The principal shape is not part of the public server API,
 * so this reads it structurally and reports "unknown" rather than guessing.
 */
export function principalPermissions(req: IAuthenticatableRequest): string | null {
  const principal = req.skPrincipal;
  if (principal && typeof principal === 'object') {
    const permissions = (principal as { permissions?: unknown }).permissions;
    if (typeof permissions === 'string') {
      return permissions;
    }
  }
  return null;
}

/**
 * True only when the principal is KNOWN read-only. An unknown/absent permission shape is never
 * treated as read-only — denying writes on a guess would lock out legitimate users on servers
 * whose principal shape differs; known-readonly is the only safe thing to enforce.
 */
export function isReadOnlyPrincipal(req: IAuthenticatableRequest): boolean {
  return principalPermissions(req) === 'readonly';
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

/**
 * The principal's identifier when the server exposes one, else null. Signal K uses the reserved
 * identifier `'AUTO'` for the anonymous read-only principal it synthesises on an `allow_readonly`
 * server, so this is how a real login is distinguished from an anonymous reader. Reads structurally
 * (`identifier`, falling back to `id`) because the principal shape is not part of the public API.
 */
export function principalIdentifier(req: IAuthenticatableRequest): string | null {
  const principal = req.skPrincipal;
  if (principal && typeof principal === 'object') {
    const p = principal as { identifier?: unknown; id?: unknown };
    const id = typeof p.identifier === 'string' ? p.identifier : p.id;
    if (typeof id === 'string') {
      return id;
    }
  }
  return null;
}

/**
 * Whether the request carries a REAL authenticated principal — a login — as opposed to the anonymous
 * `AUTO` readonly principal an `allow_readonly` server attaches to an unauthenticated request. Used by
 * the session probe so the app can offer the right remedy: a signed-in read-only user is told to ask
 * an admin, an anonymous/lapsed one is told to sign in. Fails closed (never claims "logged in" on a
 * throwing strategy).
 */
export function isLoggedInPrincipal(
  strategy: ISecurityStrategy | undefined,
  req: IAuthenticatableRequest,
): boolean {
  if (!isSecurityEnabled(strategy)) {
    return true; // open server: nothing to log into, so every caller is trivially "in"
  }
  try {
    if (strategy?.getLoginStatus?.(req)?.status === 'loggedIn') {
      return true;
    }
  } catch {
    // A misbehaving strategy must never decide "logged in"; fall through to the identity check.
  }
  const id = principalIdentifier(req);
  return id !== null && id !== 'AUTO';
}

/**
 * Whether the request is the anonymous `AUTO` read-only principal (an `allow_readonly` server letting
 * an unauthenticated caller read). Distinct from a named, signed-in read-only user. False on an open
 * server (there is no such distinction to draw).
 */
export function isAnonymousPrincipal(
  strategy: ISecurityStrategy | undefined,
  req: IAuthenticatableRequest,
): boolean {
  if (!isSecurityEnabled(strategy)) {
    return false;
  }
  if (principalIdentifier(req) === 'AUTO') {
    return true;
  }
  // A readonly principal with no real login is anonymous too (defensive, for odd principal shapes).
  return principalPermissions(req) === 'readonly' && !isLoggedInPrincipal(strategy, req);
}

/**
 * The single authoritative "may this request write?" gate the web app mirrors: a caller must be
 * authorized AND not known-readonly. An authenticated principal of unknown permission shape is
 * allowed (only certainty denies — the same rule the plugin's own mutating gate uses).
 */
export function canWriteRequest(
  strategy: ISecurityStrategy | undefined,
  req: IAuthenticatableRequest,
): boolean {
  if (!isAuthorizedSensitiveRequest(strategy, req)) {
    return false;
  }
  return !isReadOnlyPrincipal(req);
}
