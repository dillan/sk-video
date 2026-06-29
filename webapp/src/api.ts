/**
 * Same-origin client for the SK Video plugin API.
 *
 * The app is served under `…/plugins/sk-video/app/`; the plugin's HTTP API is its parent
 * (`…/plugins/sk-video`). Deriving the base from the current path keeps every call origin- and
 * mount-relative, so the browser never hard-codes a host and never reaches go2rtc or a camera
 * directly — everything stays proxied same-origin, per the security model.
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

/** A loose view of `GET /status`; the plugin owns the authoritative shape. */
export interface IPluginStatus {
  ready: boolean;
  cameras?: number;
  hardware?: { tier?: string; label?: string } | null;
}

export async function fetchStatus(signal?: AbortSignal): Promise<IPluginStatus> {
  const res = await fetch(`${API_BASE}/status`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  return (await res.json()) as IPluginStatus;
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
export async function fetchMobStatus(signal?: AbortSignal): Promise<IMobStatus> {
  const res = await fetch(`${API_BASE}/mob`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`mob ${res.status}`);
  }
  return (await res.json()) as IMobStatus;
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

export async function fetchSession(signal?: AbortSignal): Promise<ISessionInfo> {
  // Same-origin: the browser rides the existing Signal K session (cookie) automatically. A bearer-token
  // server will need explicit header attachment — wired once the auth model is confirmed.
  const res = await fetch(`${API_BASE}/session`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    throw new Error(`session ${res.status}`);
  }
  return (await res.json()) as ISessionInfo;
}
