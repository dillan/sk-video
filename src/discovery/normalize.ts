/** A raw discovery hit from WS-Discovery or mDNS. */
export interface IRawDiscovery {
  /** ONVIF device service URL (WS-Discovery XAddr). */
  xaddr?: string;
  hostname?: string;
  port?: number;
  name?: string;
  /** ONVIF scopes, e.g. onvif://www.onvif.org/name/Front%20Door. */
  scopes?: string[];
}

/** A normalized camera candidate to prefill the config UI. */
export interface ICameraCandidate {
  name: string;
  host: string;
  port?: number;
  onvifUrl?: string;
}

// eslint-disable-next-line no-control-regex -- stripping control chars is the point
const CONTROL_CHARS = new RegExp('[\u0000-\u001f\u007f]+', 'g');

/**
 * Sanitizes an untrusted device string for safe display: strips control characters, collapses
 * whitespace, trims, and caps the length. (Clients must still render it as text, never as HTML.)
 */
export function sanitizeDeviceString(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);
}

/** Pulls a value out of an ONVIF scope path, e.g. .../name/Front%20Door → "Front Door". */
function scopeValue(scopes: string[] | undefined, key: string): string | undefined {
  const marker = `/${key}/`;
  for (const scope of scopes ?? []) {
    const at = scope.indexOf(marker);
    if (at === -1) {
      continue;
    }
    const raw = scope.slice(at + marker.length).split('/')[0];
    if (!raw) {
      continue;
    }
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** Normalizes a raw discovery hit into a camera candidate, or null if it has no usable address. */
export function normalizeDiscovery(raw: IRawDiscovery): ICameraCandidate | null {
  let host: string | undefined;
  let port: number | undefined;
  let onvifUrl: string | undefined;

  if (raw.xaddr) {
    let url: URL;
    try {
      url = new URL(raw.xaddr);
    } catch {
      return null;
    }
    // Only trust http(s) device URLs — a hostile device must not smuggle javascript:/file: here.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    host = url.hostname;
    port = url.port ? Number(url.port) : undefined;
    onvifUrl = raw.xaddr;
  } else if (raw.hostname) {
    host = raw.hostname;
    port = raw.port;
  }

  if (!host) {
    return null;
  }

  const rawName = raw.name ?? scopeValue(raw.scopes, 'name');
  const name = rawName ? sanitizeDeviceString(rawName) : '';

  const candidate: ICameraCandidate = { name: name || host, host };
  if (port !== undefined) {
    candidate.port = port;
  }
  if (onvifUrl !== undefined) {
    candidate.onvifUrl = onvifUrl;
  }
  return candidate;
}
