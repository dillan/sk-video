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
