/**
 * The only stream schemes a camera definition may use. This allow-list is a security control: it
 * keeps dangerous go2rtc source schemes (exec:, ffmpeg:, pipe:, …) out of the system, so a camera
 * definition can never be turned into a shell command.
 */
export const CAMERA_SCHEMES = ['rtsp', 'rtsps', 'rtmp', 'http', 'https', 'onvif'] as const;
export type TCameraScheme = (typeof CAMERA_SCHEMES)[number];

/** Where a camera is mounted on the vessel — drives auto-layout, role selection and geo-pointing. */
export const CAMERA_MOUNTS = [
  'bow',
  'stern',
  'port',
  'starboard',
  'mast',
  'spreader',
  'cockpit',
  'helm',
  'deck',
  'cabin',
  'engine',
  'transom',
  'radararch',
  'interior',
] as const;
export type TCameraMount = (typeof CAMERA_MOUNTS)[number];

/** What a camera is for. */
export const CAMERA_ROLES = [
  'navigation',
  'docking',
  'anchor',
  'security',
  'engine',
  'deck',
  'cockpit',
  'helm',
  'general',
] as const;
export type TCameraRole = (typeof CAMERA_ROLES)[number];

/** Optional imaging controls a camera reports (detected over ONVIF, never assumed). */
export const IMAGING_CONTROLS = [
  'irCut',
  'wdr',
  'defog',
  'focus',
  'brightness',
  'exposure',
] as const;
export type TImagingControl = (typeof IMAGING_CONTROLS)[number];

/** Video codecs the plugin reasons about for playback selection. */
export const CAMERA_CODECS = ['h264', 'h265', 'mjpeg'] as const;
export type TCameraCodec = (typeof CAMERA_CODECS)[number];

export interface ICameraSource {
  scheme: TCameraScheme;
  host: string;
  port?: number;
  path?: string;
}

/** How the camera is mounted on the boat. `bearingRelativeDeg` is clockwise from the bow (0 = forward). */
export interface ICameraPlacement {
  mount?: TCameraMount;
  bearingRelativeDeg?: number;
  heightM?: number;
}

/** Capability flags — server-derived (e.g. from ONVIF), never trusted from a client for behaviour. */
export interface ICameraCapabilities {
  ptz?: boolean;
  absolutePtz?: boolean;
  audio?: boolean;
  audioBackchannel?: boolean;
  substreams?: boolean;
  imaging?: TImagingControl[];
}

export interface ICameraMedia {
  codec?: TCameraCodec;
  profileToken?: string;
  substreamPath?: string;
}

/** One axis of a per-camera degrees → normalised ONVIF (-1..1) calibration. */
export interface ICalibrationAxisConfig {
  offset: number;
  scalePerDeg: number;
}

export interface ICameraCalibration {
  pan: ICalibrationAxisConfig;
  tilt: ICalibrationAxisConfig;
}

/** A camera definition as stored/served via the Signal K `cameras` resource (no credentials). */
export interface ICamera {
  name: string;
  enabled: boolean;
  source: ICameraSource;
  placement?: ICameraPlacement;
  role?: TCameraRole;
  capabilities?: ICameraCapabilities;
  media?: ICameraMedia;
  calibration?: ICameraCalibration;
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
const TOKEN_RE = /^[A-Za-z0-9_.-]{1,64}$/; // ONVIF profile token charset
const ALLOWED_TOP_KEYS = new Set([
  'name',
  'enabled',
  'source',
  'placement',
  'role',
  'capabilities',
  'media',
  'calibration',
]);
const ALLOWED_SOURCE_KEYS = new Set(['scheme', 'host', 'port', 'path']);
const PLACEMENT_KEYS = new Set(['mount', 'bearingRelativeDeg', 'heightM']);
const CAPABILITY_BOOLS = ['ptz', 'absolutePtz', 'audio', 'audioBackchannel', 'substreams'] as const;
const CAPABILITY_KEYS = new Set<string>([...CAPABILITY_BOOLS, 'imaging']);
const MEDIA_KEYS = new Set(['codec', 'profileToken', 'substreamPath']);
const CALIBRATION_KEYS = new Set(['pan', 'tilt']);
const AXIS_KEYS = new Set(['offset', 'scalePerDeg']);

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`unexpected ${label} field "${key}"`);
    }
  }
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validatePlacement(input: unknown, errors: string[]): ICameraPlacement | undefined {
  const o = asObject(input);
  if (!o) {
    errors.push('placement must be an object');
    return undefined;
  }
  rejectUnknownKeys(o, PLACEMENT_KEYS, 'placement', errors);
  const out: ICameraPlacement = {};
  if (o.mount !== undefined) {
    if (typeof o.mount === 'string' && (CAMERA_MOUNTS as readonly string[]).includes(o.mount)) {
      out.mount = o.mount as TCameraMount;
    } else {
      errors.push('placement.mount is not a recognised mount');
    }
  }
  if (o.bearingRelativeDeg !== undefined) {
    if (isFiniteInRange(o.bearingRelativeDeg, 0, 360)) {
      out.bearingRelativeDeg = o.bearingRelativeDeg;
    } else {
      errors.push('placement.bearingRelativeDeg must be between 0 and 360');
    }
  }
  if (o.heightM !== undefined) {
    if (isFiniteInRange(o.heightM, 0, 100)) {
      out.heightM = o.heightM;
    } else {
      errors.push('placement.heightM must be between 0 and 100');
    }
  }
  return out;
}

function validateRole(input: unknown, errors: string[]): TCameraRole | undefined {
  if (typeof input === 'string' && (CAMERA_ROLES as readonly string[]).includes(input)) {
    return input as TCameraRole;
  }
  errors.push('role is not a recognised role');
  return undefined;
}

function validateCapabilities(input: unknown, errors: string[]): ICameraCapabilities | undefined {
  const o = asObject(input);
  if (!o) {
    errors.push('capabilities must be an object');
    return undefined;
  }
  rejectUnknownKeys(o, CAPABILITY_KEYS, 'capabilities', errors);
  const out: ICameraCapabilities = {};
  for (const key of CAPABILITY_BOOLS) {
    if (o[key] !== undefined) {
      if (typeof o[key] === 'boolean') {
        out[key] = o[key] as boolean;
      } else {
        errors.push(`capabilities.${key} must be a boolean`);
      }
    }
  }
  if (o.imaging !== undefined) {
    if (
      Array.isArray(o.imaging) &&
      o.imaging.every(
        (c) => typeof c === 'string' && (IMAGING_CONTROLS as readonly string[]).includes(c),
      )
    ) {
      out.imaging = o.imaging as TImagingControl[];
    } else {
      errors.push('capabilities.imaging must be a list of supported controls');
    }
  }
  return out;
}

function validateMedia(input: unknown, errors: string[]): ICameraMedia | undefined {
  const o = asObject(input);
  if (!o) {
    errors.push('media must be an object');
    return undefined;
  }
  rejectUnknownKeys(o, MEDIA_KEYS, 'media', errors);
  const out: ICameraMedia = {};
  if (o.codec !== undefined) {
    if (typeof o.codec === 'string' && (CAMERA_CODECS as readonly string[]).includes(o.codec)) {
      out.codec = o.codec as TCameraCodec;
    } else {
      errors.push('media.codec is not a recognised codec');
    }
  }
  if (o.profileToken !== undefined) {
    if (typeof o.profileToken === 'string' && TOKEN_RE.test(o.profileToken)) {
      out.profileToken = o.profileToken;
    } else {
      errors.push('media.profileToken is invalid');
    }
  }
  if (o.substreamPath !== undefined) {
    if (
      typeof o.substreamPath === 'string' &&
      PATH_RE.test(o.substreamPath) &&
      !o.substreamPath.includes('..')
    ) {
      out.substreamPath = o.substreamPath;
    } else {
      errors.push('media.substreamPath must be a safe absolute path');
    }
  }
  return out;
}

function validateAxis(
  input: unknown,
  label: string,
  errors: string[],
): ICalibrationAxisConfig | undefined {
  const o = asObject(input);
  if (!o) {
    errors.push(`calibration.${label} must be an object`);
    return undefined;
  }
  rejectUnknownKeys(o, AXIS_KEYS, `calibration.${label}`, errors);
  if (
    typeof o.offset === 'number' &&
    Number.isFinite(o.offset) &&
    typeof o.scalePerDeg === 'number' &&
    Number.isFinite(o.scalePerDeg)
  ) {
    return { offset: o.offset, scalePerDeg: o.scalePerDeg };
  }
  errors.push(`calibration.${label} must have finite offset and scalePerDeg`);
  return undefined;
}

function validateCalibration(input: unknown, errors: string[]): ICameraCalibration | undefined {
  const o = asObject(input);
  if (!o) {
    errors.push('calibration must be an object');
    return undefined;
  }
  rejectUnknownKeys(o, CALIBRATION_KEYS, 'calibration', errors);
  const pan = validateAxis(o.pan, 'pan', errors);
  const tilt = validateAxis(o.tilt, 'tilt', errors);
  if (pan && tilt) {
    return { pan, tilt };
  }
  return undefined;
}

export function validateCamera(input: unknown): IValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['camera must be an object'] };
  }
  const obj = input as Record<string, unknown>;
  const errors: string[] = [];

  // Reject unknown top-level fields — this is how embedded credentials get rejected.
  rejectUnknownKeys(obj, ALLOWED_TOP_KEYS, '', errors);

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
    const schemeOk =
      typeof scheme === 'string' && (CAMERA_SCHEMES as readonly string[]).includes(scheme);
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
        ...(path !== undefined ? { path } : {}),
      };
    }
  }

  // Optional vessel-context metadata. All optional, so existing minimal cameras stay valid.
  const placement =
    obj.placement !== undefined ? validatePlacement(obj.placement, errors) : undefined;
  const role = obj.role !== undefined ? validateRole(obj.role, errors) : undefined;
  const capabilities =
    obj.capabilities !== undefined ? validateCapabilities(obj.capabilities, errors) : undefined;
  const media = obj.media !== undefined ? validateMedia(obj.media, errors) : undefined;
  const calibration =
    obj.calibration !== undefined ? validateCalibration(obj.calibration, errors) : undefined;

  if (errors.length > 0 || !normalizedSource) {
    return { valid: false, errors: errors.length ? errors : ['invalid camera'] };
  }
  return {
    valid: true,
    errors: [],
    value: {
      name,
      enabled: enabled as boolean,
      source: normalizedSource,
      ...(placement && Object.keys(placement).length ? { placement } : {}),
      ...(role ? { role } : {}),
      ...(capabilities && Object.keys(capabilities).length ? { capabilities } : {}),
      ...(media && Object.keys(media).length ? { media } : {}),
      ...(calibration ? { calibration } : {}),
    },
  };
}
