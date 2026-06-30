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
  source?: { scheme: string; host: string; port?: number; path?: string };
  placement?: { mount?: string; bearingRelativeDeg?: number; heightM?: number };
  role?: string;
  capabilities?: {
    ptz?: boolean;
    absolutePtz?: boolean;
    audio?: boolean;
    audioBackchannel?: boolean;
    substreams?: boolean;
  };
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

// ---- Stream health + transport (diagnostics / the player's rung walk) ----

export type TTransport = 'webrtc' | 'hls' | 'mjpeg';

export interface IStreamHealth {
  online: boolean;
  producers: number;
  consumers: number;
  codecs: string[];
  sources: string[];
}
export interface ITransportHints {
  recommended: TTransport[];
  codecs: string[];
  online: boolean;
  note: string;
}

export const fetchHealth = (id: string, signal?: AbortSignal): Promise<IStreamHealth> =>
  getJson<IStreamHealth>(`/cameras/${encodeURIComponent(id)}/health`, 'health', signal);

export const fetchTransport = (id: string, signal?: AbortSignal): Promise<ITransportHints> =>
  getJson<ITransportHints>(`/cameras/${encodeURIComponent(id)}/transport`, 'transport', signal);

/** Stream variant: the full-res main, or the low-res H.264 `_sub` (browser-decodable when main is H.265). */
export type TStreamVariant = 'main' | 'sub';
const subQuery = (variant: TStreamVariant, sep: '?' | '&'): string =>
  variant === 'sub' ? `${sep}variant=sub` : '';

/** Build a same-origin frame.jpeg URL for the MJPEG still-refresh rung (cache-busted per frame). */
export const frameUrl = (id: string, ts: number, variant: TStreamVariant = 'main'): string =>
  `${API_BASE}/cameras/${encodeURIComponent(id)}/frame.jpeg?t=${ts}${subQuery(variant, '&')}`;
export const hlsUrl = (id: string, variant: TStreamVariant = 'main'): string =>
  `${API_BASE}/cameras/${encodeURIComponent(id)}/stream.m3u8${subQuery(variant, '?')}`;
export const whepUrl = (id: string, variant: TStreamVariant = 'main'): string =>
  `${API_BASE}/cameras/${encodeURIComponent(id)}/whep${subQuery(variant, '?')}`;

// ---- Mutating camera controls (auth-gated server-side; a 401 means sign-in required) ----

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function send(path: string, init: RequestInit, what: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(`${what} failed (${res.status})`, res.status);
  }
  return res;
}

const cam = (id: string): string => `/cameras/${encodeURIComponent(id)}`;

export const ptzNudge = (
  id: string,
  move: { pan?: number; tilt?: number; zoom?: number },
): Promise<Response> =>
  send(`${cam(id)}/ptz`, { method: 'POST', body: JSON.stringify(move) }, 'ptz');

export const ptzStop = (id: string): Promise<Response> =>
  send(`${cam(id)}/ptz/stop`, { method: 'POST' }, 'ptz stop');

export interface IPtzPreset {
  token: string;
  name?: string;
}
export const listPtzPresets = (id: string, signal?: AbortSignal): Promise<IPtzPreset[]> =>
  getJson<IPtzPreset[]>(`${cam(id)}/ptz/presets`, 'presets', signal);

export const gotoPtzPreset = (id: string, token: string): Promise<Response> =>
  send(`${cam(id)}/ptz/preset`, { method: 'POST', body: JSON.stringify({ token }) }, 'preset');

export type TImagingPreset = 'day' | 'night' | 'fog' | 'glare' | 'auto';
export const applyImagingPreset = async (id: string, preset: TImagingPreset): Promise<void> => {
  await send(
    `${cam(id)}/imaging/preset`,
    { method: 'POST', body: JSON.stringify({ preset }) },
    'imaging',
  );
};

/** Telemetry-stamped snapshot; `hasFix:false` drives the honest "no GPS fix" result chip. */
export interface ISnapshotResult {
  hasFix?: boolean;
  [k: string]: unknown;
}
export const captureSnapshot = async (id: string): Promise<ISnapshotResult> => {
  const res = await send(`${cam(id)}/snapshot`, { method: 'POST' }, 'snapshot');
  return (await res.json()) as ISnapshotResult;
};

export interface IRecordResult {
  recording: boolean;
  error?: string;
}
export const setRecording = async (id: string, active: boolean): Promise<IRecordResult> => {
  const res = await send(
    `${cam(id)}/record`,
    { method: 'POST', body: JSON.stringify({ active }) },
    'record',
  );
  return (await res.json()) as IRecordResult;
};

// ---- Safety actions (MOB arm/disarm, mark incident, AIS slew) ----

/** Arm or disarm the man-overboard response. Mirrors the shared Signal K PUT action. */
export const armMob = async (active: boolean): Promise<IMobStatus> => {
  const res = await send('/mob', { method: 'POST', body: JSON.stringify({ active }) }, 'MOB');
  return (await res.json()) as IMobStatus;
};

/** Package an incident bundle now (the reliable manual trigger). */
export const markIncident = (): Promise<Response> =>
  send('/incidents', { method: 'POST', body: JSON.stringify({}) }, 'mark incident');

/** Aim one calibrated PTZ camera at the nearest-CPA AIS target (a single deterministic aim). */
export const slewToCue = (id: string): Promise<Response> =>
  send(`${cam(id)}/slew-to-cue`, { method: 'POST' }, 'slew');

// ---- PTZ position + calibration (for the calibration wizard) ----

export interface IPtzPosition {
  pan: number;
  tilt: number;
  zoom?: number;
}
export const fetchPtzPosition = (id: string, signal?: AbortSignal): Promise<IPtzPosition> =>
  getJson<IPtzPosition>(`${cam(id)}/ptz/position`, 'position', signal);

export interface ICalibrationSample {
  deg: number;
  normalized: number;
}
/** Two {deg, normalized} samples per axis solve the degrees→normalised map for absolute aiming. */
export const submitCalibration = async (
  id: string,
  samples: { pan: ICalibrationSample[]; tilt: ICalibrationSample[] },
): Promise<void> => {
  await send(
    `${cam(id)}/calibration`,
    { method: 'POST', body: JSON.stringify(samples) },
    'calibration',
  );
};

// ---- Discovery + onboarding ----

/** A device found by the LAN scan (WS-Discovery + mDNS). A genuine ONVIF camera's onvifUrl ends in
 * `/onvif/...`; other WSD responders (NAS, printers) surface here too and should be dismissible. */
export interface ICandidate {
  name: string;
  host: string;
  port?: number;
  onvifUrl?: string;
}

export const discoverCameras = async (signal?: AbortSignal): Promise<ICandidate[]> => {
  const body = await getJson<{ cameras?: ICandidate[] }>('/cameras/discover', 'discover', signal);
  return body.cameras ?? [];
};

/** One advertised media profile (codec + resolution + source), as returned by introspection. */
export interface IIntrospectStream {
  codec: string;
  width?: number;
  height?: number;
  source: { scheme: string; host: string; port?: number; path?: string };
  profileToken?: string;
  name?: string;
}

/** The pre-filled fields ONVIF introspection returns (mirrors the plugin's IIntrospectResult). */
export interface IIntrospectResult {
  manufacturer?: string;
  model?: string;
  serialNumber?: string | number;
  source?: { scheme: string; host: string; port?: number; path?: string };
  /** Codec of the main (recording) stream — lets the UI route around H.265 in the browser. */
  codec?: string;
  /** Every advertised profile; surfaced so the operator can see what the camera offers. */
  streams?: IIntrospectStream[];
  /** Path of a browser-decodable H.264 substream on the same endpoint as `source`, when present. */
  substreamPath?: string;
  substreams?: boolean;
  snapshotUri?: string;
  ptz: boolean;
  absolutePtz: boolean;
  imaging: boolean;
  imagingControls: string[];
  audio: boolean;
  audioBackchannel: boolean;
}

export interface IIntrospectInput {
  host: string;
  port?: number;
  username?: string;
  password?: string;
}
export const introspectCamera = async (input: IIntrospectInput): Promise<IIntrospectResult> => {
  const res = await send(
    '/cameras/discover/introspect',
    { method: 'POST', body: JSON.stringify(input) },
    'introspect',
  );
  return (await res.json()) as IIntrospectResult;
};

// ---- Camera resource CRUD + credentials ----

/** The camera definition written to the Signal K resource (closed field-set; no credentials). */
export interface ICameraWrite {
  name: string;
  enabled: boolean;
  source: { scheme: string; host: string; port?: number; path?: string };
  placement?: { mount?: string; bearingRelativeDeg?: number };
  role?: string;
  capabilities?: {
    ptz?: boolean;
    absolutePtz?: boolean;
    audio?: boolean;
    audioBackchannel?: boolean;
    substreams?: boolean;
  };
  /** Codec + substream path captured at onboarding; drives go2rtc's `_sub` stream + transport routing. */
  media?: { codec?: string; substreamPath?: string };
}

export const saveCamera = async (id: string, body: ICameraWrite): Promise<void> => {
  const res = await fetch(`${SK_ROOT}/signalk/v2/api/resources/cameras/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(`save camera (${res.status})`, res.status);
  }
};

export const deleteCamera = async (id: string): Promise<void> => {
  const res = await fetch(`${SK_ROOT}/signalk/v2/api/resources/cameras/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(`delete camera (${res.status})`, res.status);
  }
};

export interface ICredentialPresence {
  hasUsername: boolean;
  hasPassword: boolean;
}
export const getCredentialPresence = (
  id: string,
  signal?: AbortSignal,
): Promise<ICredentialPresence> =>
  getJson<ICredentialPresence>(`${cam(id)}/credentials`, 'credentials', signal);

/** Store a write-only camera login (never echoed back). */
export const setCredentials = async (
  id: string,
  username: string,
  password: string,
): Promise<void> => {
  await send(
    `${cam(id)}/credentials`,
    { method: 'POST', body: JSON.stringify({ username, password }) },
    'credentials',
  );
};

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

// ---- Imported videos (the shipped /videos asset store) ----

/** An uploaded video, kept separate from camera recordings/incidents. */
export interface IVideoAsset {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: number;
}

export const fetchVideos = (signal?: AbortSignal): Promise<IVideoAsset[]> =>
  getJson<{ videos: IVideoAsset[] }>('/videos', 'videos', signal).then((r) => r.videos);

/** Same-origin URL to stream a stored video (Range-served), e.g. as a <video> source. */
export const videoUrl = (id: string): string => `${API_BASE}/videos/${encodeURIComponent(id)}`;

/** Upload a video; the body is streamed to disk and validated by magic bytes server-side. */
export const uploadVideo = async (file: File): Promise<IVideoAsset> => {
  const res = await fetch(`${API_BASE}/videos`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Filename': file.name, Accept: 'application/json' },
    body: file,
  });
  if (!res.ok) {
    throw new ApiError(`upload failed (${res.status})`, res.status);
  }
  return res.json() as Promise<IVideoAsset>;
};

export const deleteVideo = async (id: string): Promise<void> => {
  await send(`/videos/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'delete video');
};
