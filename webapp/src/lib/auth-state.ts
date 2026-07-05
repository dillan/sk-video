/**
 * The pure, React-free heart of the auth flow: the state machine and the shape the UI reads.
 *
 * SK Video has no user system — it rides Signal K's session cookie. This module turns a `/session`
 * probe (plus connectivity + whether a sign-in is in flight) into one of ten UI states. The
 * load-bearing rule is that a bare 401 can mean three different things — a lapsed session, an
 * anonymous reader, or a signed-in read-only user — so we never branch on the status code; we branch
 * on the fresh, server-reported truth carried here.
 */

/** The raw `/session` payload as the plugin sends it (new fields optional so an old plugin still works). */
export interface RawSession {
  securityEnabled: boolean;
  authenticated: boolean;
  readOnly?: boolean;
  loggedIn?: boolean;
  canWrite?: boolean;
  anonymous?: boolean;
  username?: string;
  userLevel?: string;
  pluginVersion: string;
}

/** The normalized session the UI reads — every field present, derived once. */
export interface Session {
  securityEnabled: boolean;
  /** A REAL login, not the anonymous `AUTO` readonly principal. Drives the "ask admin" vs "sign in" copy. */
  loggedIn: boolean;
  /** The single flag write controls gate on. */
  canWrite: boolean;
  /** The anonymous `AUTO` readonly principal (an `allow_readonly` open-read). */
  anonymous: boolean;
  username?: string;
  userLevel?: string;
  pluginVersion: string;
}

export type AuthState =
  | 'checking'
  | 'open'
  | 'signedIn'
  | 'signinRequired'
  | 'signingIn'
  | 'signinFailed'
  | 'reauth'
  | 'readonly'
  | 'signingOut'
  | 'unreachable';

export interface DeriveInput {
  /** The last `/session` probe failed with a NETWORK error (not an HTTP answer). */
  unreachable: boolean;
  /** A sign-in ('in') or sign-out ('out') is in flight. */
  signing: 'none' | 'in' | 'out';
  /** This shell has, at some point, held a writable-or-logged-in session — tells state 7 from state 4. */
  everLoggedIn: boolean;
  /** The most recent sign-in attempt was rejected. */
  signInError: boolean;
}

/**
 * Fill the enriched fields from the old three booleans when a not-yet-upgraded plugin omits them, so
 * a new shell degrades cleanly. `canWrite` mirrors the plugin's own gate: authenticated and not
 * known-readonly. `loggedIn` is best-effort from the old shape (a secured server can't tell a real
 * login from the anonymous principal without the new field, so it trusts `authenticated`).
 */
export function normalizeSession(s: RawSession): Session {
  const readOnly = s.readOnly === true;
  return {
    securityEnabled: s.securityEnabled,
    loggedIn: s.loggedIn ?? (s.securityEnabled ? s.authenticated : true),
    canWrite: s.canWrite ?? (s.authenticated && !readOnly),
    anonymous: s.anonymous ?? false,
    username: s.username,
    userLevel: s.userLevel,
    pluginVersion: s.pluginVersion,
  };
}

/**
 * Map (session, connectivity, sign-in progress) → one UI state. Order matters:
 * - a sign-out in flight wins outright;
 * - with no session yet, it's "unreachable" only when the probe network-failed, else "checking"
 *   (a 401 always yields a session object, so it never lands here — it's "signinRequired"/"reauth");
 * - a sign-in in flight / just-failed wins next;
 * - then the posture: open, then writable (signedIn), then logged-in-read-only (readonly, ask admin),
 *   and finally not-authenticated → "reauth" if this shell was ever signed in, else "signinRequired".
 * `canWrite` is checked before `loggedIn`, so a genuinely writable user is never pushed into sign-in
 * even if `loggedIn` mis-detects on an odd server.
 */
export function deriveAuthState(session: Session | null, input: DeriveInput): AuthState {
  if (input.signing === 'out') {
    return 'signingOut';
  }
  if (session === null) {
    return input.unreachable ? 'unreachable' : 'checking';
  }
  if (input.signing === 'in') {
    return 'signingIn';
  }
  if (input.signInError) {
    return 'signinFailed';
  }
  if (!session.securityEnabled) {
    return 'open';
  }
  if (session.canWrite) {
    return 'signedIn';
  }
  if (session.loggedIn) {
    return 'readonly';
  }
  return input.everLoggedIn ? 'reauth' : 'signinRequired';
}
