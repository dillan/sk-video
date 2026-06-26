/**
 * The only stream schemes a camera definition may use. This allow-list is a security control: it
 * keeps dangerous go2rtc source schemes (exec:, ffmpeg:, pipe:, …) out of the system, so a camera
 * definition can never be turned into a shell command.
 */
export const CAMERA_SCHEMES = ['rtsp', 'rtsps', 'rtmp', 'http', 'https', 'onvif'] as const;
export type TCameraScheme = (typeof CAMERA_SCHEMES)[number];

export interface ICameraSource {
  scheme: TCameraScheme;
  host: string;
  port?: number;
  path?: string;
}

/** A camera definition as stored/served via the Signal K `cameras` resource (no credentials). */
export interface ICamera {
  name: string;
  enabled: boolean;
  source: ICameraSource;
}

export interface IValidationResult {
  valid: boolean;
  errors: string[];
  /** The normalised camera, present only when valid. */
  value?: ICamera;
}

/**
 * Validates and normalises an untrusted camera definition. Returns the cleaned record when valid, or
 * a list of errors. Credentials are never part of a camera resource and are rejected here.
 */
const HOST_RE = /^[A-Za-z0-9._:-]+$/; // hostname or IP literal (IPv6 colons allowed)
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/; // safe absolute URL path
const ALLOWED_TOP_KEYS = new Set(['name', 'enabled', 'source']);
const ALLOWED_SOURCE_KEYS = new Set(['scheme', 'host', 'port', 'path']);

export function validateCamera(input: unknown): IValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['camera must be an object'] };
  }
  const obj = input as Record<string, unknown>;
  const errors: string[] = [];

  // Reject unknown top-level fields — this is how embedded credentials get rejected.
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      errors.push(`unexpected field "${key}"`);
    }
  }

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) {
    errors.push('name is required');
  } else if (name.length > 100) {
    errors.push('name is too long');
  }

  const enabled = obj.enabled === undefined ? true : obj.enabled;
  if (typeof enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  let normalizedSource: ICameraSource | undefined;
  const source = obj.source;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    errors.push('source is required');
  } else {
    const s = source as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      if (!ALLOWED_SOURCE_KEYS.has(key)) {
        errors.push(`unexpected source field "${key}"`);
      }
    }

    const scheme = s.scheme;
    const schemeOk = typeof scheme === 'string' && (CAMERA_SCHEMES as readonly string[]).includes(scheme);
    if (!schemeOk) {
      errors.push(`source.scheme must be one of ${CAMERA_SCHEMES.join(', ')}`);
    }

    const host = typeof s.host === 'string' ? s.host.trim() : '';
    if (!host) {
      errors.push('source.host is required');
    } else if (!HOST_RE.test(host)) {
      errors.push('source.host contains invalid characters');
    }

    let port: number | undefined;
    if (s.port !== undefined) {
      if (typeof s.port !== 'number' || !Number.isInteger(s.port) || s.port < 1 || s.port > 65535) {
        errors.push('source.port must be an integer between 1 and 65535');
      } else {
        port = s.port;
      }
    }

    let path: string | undefined;
    if (s.path !== undefined) {
      if (typeof s.path !== 'string' || !PATH_RE.test(s.path) || s.path.includes('..')) {
        errors.push('source.path must be a safe absolute path');
      } else {
        path = s.path;
      }
    }

    if (schemeOk && host && !errors.length) {
      normalizedSource = {
        scheme: scheme as TCameraScheme,
        host,
        ...(port !== undefined ? { port } : {}),
        ...(path !== undefined ? { path } : {})
      };
    }
  }

  if (errors.length > 0 || !normalizedSource) {
    return { valid: false, errors: errors.length ? errors : ['invalid camera'] };
  }
  return { valid: true, errors: [], value: { name, enabled: enabled as boolean, source: normalizedSource } };
}
