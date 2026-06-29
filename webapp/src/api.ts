/**
 * Same-origin client for the SK Video plugin API.
 *
 * The app is served under `…/plugins/sk-video/app/`; the plugin's HTTP API is its parent
 * (`…/plugins/sk-video`). Deriving the base from the current path keeps every call origin- and
 * mount-relative, so the browser never hard-codes a host and never reaches go2rtc or a camera
 * directly — everything stays proxied same-origin, per the security model.
 *
 * AUTH: SK Video has no user system of its own. It rides Signal K's session — a JWT in the
 * `JAUTHENTICATION` cookie (HttpOnly, SameSite=strict), set at `/signalk/v1/auth/login` and
 * refreshed server-side via a sliding window. Because the app is same-origin, the browser sends that
 * cookie automatically on every API call (and on the delta-stream WebSocket handshake). We use
 * `credentials: 'include'` so it rides even if the app is reached through a proxy prefix. If the user
 * is already signed in to Signal K in this browser, the console is authenticated with no second login.
 */

/** Derive the plugin API base (`…/plugins/sk-video`) from the app's mount path. */
export function deriveApiBase(pathname: string): string {
  const i = pathname.indexOf('/app/');
  if (i >= 0) {
    return pathname.slice(0, i);
  }
  // Tolerate the bare mount without a trailing slash, then fall back to the conventional path.
  if (pathname.endsWith('/app')) {
    return pathname.slice(0, -'/app'.length);
  }
  return '/plugins/sk-video';
}

export const API_BASE = deriveApiBase(
  typeof window !== 'undefined' ? window.location.pathname : '/plugins/sk-video/app/',
);

/** The Signal K server root (for `/signalk/v1/*`), derived so a proxy prefix is preserved. */
export const SK_ROOT = API_BASE.replace(/\/plugins\/sk-video$/, '');

async function getJson<T>(path: string, what: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal,
  });
  if (!res.ok) {
    throw new Error(`${what} ${res.status}`);
  }
  return (await res.json()) as T;
}

/** A loose view of `GET /status`; the plugin owns the authoritative shape. */
export interface IPluginStatus {
  ready: boolean;
  cameras?: number;
  hardware?: { tier?: string; label?: string } | null;
}

export function fetchStatus(signal?: AbortSignal): Promise<IPluginStatus> {
  return getJson<IPluginStatus>('/status', 'status', signal);
}

/** Read-only man-overboard status, mirrors the plugin's `IMobStatus`. Drives the safety strip. */
export interface IMobStatus {
  active: boolean;
  targetSource: 'beacon' | 'datum' | 'none';
  aimedCameras: number;
}

/**
 * Seed the armed state on connect (and tab foreground). This is the authoritative current state — a
 * client must read it before trusting delta-stream notifications, so the strip can never silently
 * under-report an active MOB after a reconnect.
 */
export function fetchMobStatus(signal?: AbortSignal): Promise<IMobStatus> {
  return getJson<IMobStatus>('/mob', 'mob', signal);
}

/** Auth "whoami" — booleans only, mirrors the plugin's `ISessionInfo`. */
export interface ISessionInfo {
  securityEnabled: boolean;
  authenticated: boolean;
  pluginVersion: string;
}

/** A one-line description of the auth posture, for the header chip. */
export function describeAuth(session: ISessionInfo | null): string {
  if (!session) {
    return 'checking…';
  }
  if (!session.securityEnabled) {
    return 'open server';
  }
  return session.authenticated ? 'secured · signed in' : 'secured · sign in required';
}

export function fetchSession(signal?: AbortSignal): Promise<ISessionInfo> {
  return getJson<ISessionInfo>('/session', 'session', signal);
}

/** A camera definition from the Signal K `cameras` resource (subset; never includes credentials). */
export interface ICamera {
  name: string;
  enabled: boolean;
  placement?: { mount?: string; bearingRelativeDeg?: number; heightM?: number };
  role?: string;
  capabilities?: { ptz?: boolean; absolutePtz?: boolean; audio?: boolean; substreams?: boolean };
  media?: { codec?: string; substreamPath?: string; projection?: string };
}
export interface ICameraEntry extends ICamera {
  id: string;
}

/** Cameras are shared Signal K resources, read same-origin from the Resources API (keyed by id). */
export async function fetchCameras(signal?: AbortSignal): Promise<ICameraEntry[]> {
  const res = await fetch(`${SK_ROOT}/signalk/v2/api/resources/cameras`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal,
  });
  if (!res.ok) {
    throw new Error(`cameras ${res.status}`);
  }
  const map = (await res.json()) as Record<string, ICamera> | null;
  return Object.entries(map ?? {})
    .map(([id, camera]) => ({ id, ...camera }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Raw `vessels/self` tree for the telemetry strip; parsed by lib/format's parseVesselState. */
export async function fetchVesselSelf(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${SK_ROOT}/signalk/v1/api/vessels/self`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal,
  });
  if (!res.ok) {
    throw new Error(`vessel ${res.status}`);
  }
  return res.json();
}

/**
 * Sign in against Signal K's own auth — SK Video delegates entirely. The same-origin POST sets the
 * `JAUTHENTICATION` cookie; the returned token isn't needed for cookie auth. After it resolves,
 * re-probe {@link fetchSession}. Throws a friendly message on bad credentials.
 */
export async function login(
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${SK_ROOT}/signalk/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
    signal,
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? 'Incorrect username or password.' : `Sign-in failed (${res.status}).`,
    );
  }
}

/** Sign out of the Signal K session (clears the cookie). */
export async function logout(signal?: AbortSignal): Promise<void> {
  await fetch(`${SK_ROOT}/signalk/v1/auth/logout`, {
    method: 'PUT',
    credentials: 'include',
    signal,
  });
}
