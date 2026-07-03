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
  /** Frigate posture: an empty detection feed must be distinguishable from "not wired". */
  frigate?: { configured: boolean; connected: boolean };
}

export function fetchStatus(signal?: AbortSignal): Promise<IPluginStatus> {
  return getJson<IPluginStatus>('/status', 'status', signal);
}

/**
 * Per-camera MOB aim outcome: `aimed` (commanded at the target), `at-limit` (bearing beyond the pan
 * range — pointing at its mechanical limit, not the casualty), `no-solution` (no calibration or
 * heading), `command-failed` (the PTZ dispatch was rejected).
 */
export type TAimOutcome = 'aimed' | 'at-limit' | 'no-solution' | 'command-failed';

/** Read-only man-overboard status, mirrors the plugin's `IMobStatus`. Drives the safety strip. */
export interface IMobStatus {
  active: boolean;
  targetSource: 'beacon' | 'datum' | 'none';
  aimedCameras: number;
  /** Total enabled cameras with absolute PTZ — the "of M" denominator. */
  capableCameras: number;
  /** Ids of the cameras commanded at the target on the most recent re-aim. */
  aimedCameraIds: string[];
  /** Per capable camera, the outcome of the most recent re-aim; empty while idle. */
  cameraAims?: Array<{ id: string; outcome: TAimOutcome }>;
  /** Epoch ms the event was armed, or null when idle. */
  armedAt: number | null;
  /** Epoch ms of the most recent re-aim (the heartbeat), or null when idle. */
  lastReaimAt: number | null;
  /** The experimental visual-refine assist: shown only when enabled, always NOT safety-rated. */
  visualRefine?: { enabled: boolean; active: boolean };
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
  /** The principal is KNOWN read-only — write controls should be disabled with a why. */
  readOnly?: boolean;
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
  if (!session.authenticated) {
    return 'secured · sign in required';
  }
  return session.readOnly === true ? 'secured · read-only' : 'secured · signed in';
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
    spotlight?: boolean;
    alarm?: boolean;
    imaging?: string[];
    auxCommands?: string[];
  };
  media?: { codec?: string; substreamPath?: string; projection?: string };
  /** Device identity from ONVIF (durable identity + firmware, for re-scan / change detection). */
  device?: { manufacturer?: string; model?: string; serial?: string; firmware?: string };
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

/** One camera in the aggregate wall projection: definition + health(+last-good) + transport walk. */
export interface IProjectedCamera extends Omit<ICameraEntry, 'source'> {
  safetyCritical: boolean;
  /** go2rtc health merged with the last-good tracker; null while the gateway is down. */
  health: (IStreamHealth & { lastGoodAt: number | null; trackedSince: number }) | null;
  /** Server-recommended transport walk; null while the gateway is down. */
  transport: ITransportHints | null;
}

export interface ILayoutGroup {
  key: string;
  label: string;
  cameraIds: string[];
}

/** The aggregate wall projection: one request instead of N health + N transport fan-outs. */
export interface ICamerasProjection {
  gatewayOnline: boolean;
  cameras: IProjectedCamera[];
  layout: { groups: ILayoutGroup[] };
}

export const fetchCamerasProjection = (signal?: AbortSignal): Promise<ICamerasProjection> =>
  getJson<ICamerasProjection>('/cameras', 'cameras', signal);

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
  /** Epoch ms the camera last had an active producer; null = never since `trackedSince`. */
  lastGoodAt?: number | null;
  /** Epoch ms the server began tracking (plugin start) — the honest horizon for "never seen". */
  trackedSince?: number;
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

/** The server categorises ONVIF/camera failures (see src/onvif/onvif-errors.ts). */
export type TApiFailureReason = 'unreachable' | 'auth' | 'onvif' | 'unknown';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's operator-facing next step (body.error), when it sent one. */
    readonly hint?: string,
    /** The server's failure category (body.reason), when it sent one. */
    readonly reason?: TApiFailureReason,
  ) {
    super(message);
  }
}

/** Pull the structured `{ error, reason }` an errored route may carry, without throwing on non-JSON. */
async function readErrorBody(
  res: Response,
): Promise<{ error?: string; reason?: TApiFailureReason }> {
  try {
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return {};
    return (await res.json()) as { error?: string; reason?: TApiFailureReason };
  } catch {
    return {};
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
    const body = await readErrorBody(res);
    throw new ApiError(`${what} failed (${res.status})`, res.status, body.error, body.reason);
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

/** Toggle an ONVIF auxiliary fixture — a white-light spotlight or an audible alarm/siren. */
export const setSpotlight = (id: string, on: boolean): Promise<Response> =>
  send(`${cam(id)}/spotlight`, { method: 'POST', body: JSON.stringify({ on }) }, 'spotlight');
export const setAlarm = (id: string, on: boolean): Promise<Response> =>
  send(`${cam(id)}/alarm`, { method: 'POST', body: JSON.stringify({ on }) }, 'alarm');

export interface IPtzPreset {
  token: string;
  name?: string;
}
export const listPtzPresets = (id: string, signal?: AbortSignal): Promise<IPtzPreset[]> =>
  getJson<IPtzPreset[]>(`${cam(id)}/ptz/presets`, 'presets', signal);

export const gotoPtzPreset = (id: string, token: string): Promise<Response> =>
  send(`${cam(id)}/ptz/preset`, { method: 'POST', body: JSON.stringify({ token }) }, 'preset');

/**
 * Two-way audio: POST the browser's SDP offer (carrying a mic track) to the camera's native backchannel
 * and return go2rtc's SDP answer. Same-origin proxied; gated server-side on the camera reporting an
 * audio output (a 404 means no backchannel). Best-effort hailing/intercom — not telephony-grade.
 */
export const negotiateTalk = async (id: string, offerSdp: string): Promise<string> => {
  const res = await fetch(`${API_BASE}${cam(id)}/talk`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
  });
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new ApiError(`talk failed (${res.status})`, res.status, body.error, body.reason);
  }
  return res.text();
};

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

/**
 * Package an incident bundle (the reliable manual trigger). With `triggerAt` (epoch-ms) it's a
 * RETROSPECTIVE mark from a scrubbed DVR moment — the clip is cut from the rolling buffer around that
 * time. No args = a live mark now.
 */
export const markIncident = (
  req: {
    cameras?: string[];
    triggerAt?: number;
    preMs?: number;
    postMs?: number;
    note?: string;
  } = {},
): Promise<Response> =>
  send('/incidents', { method: 'POST', body: JSON.stringify(req) }, 'mark incident');

/** Aim one calibrated PTZ camera at the nearest-CPA AIS target (a single deterministic aim). */
export const slewToCue = (id: string): Promise<Response> =>
  send(`${cam(id)}/slew-to-cue`, { method: 'POST' }, 'slew');

/**
 * Acknowledge a plugin notification SHARED-STATE: the plugin writes the ack back to Signal K
 * notification state, so silencing an alarm here silences it on every client.
 */
export const ackNotification = (key: string): Promise<Response> =>
  send('/notifications/ack', { method: 'POST', body: JSON.stringify({ key }) }, 'acknowledge');

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
  spotlight?: boolean;
  alarm?: boolean;
  auxCommands?: string[];
  firmwareVersion?: string;
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

/** Re-introspect an existing camera using its stored credentials; returns the fresh discovery to merge. */
export const rescanCamera = async (id: string): Promise<IIntrospectResult> => {
  const res = await send(`${cam(id)}/rescan`, { method: 'POST' }, 'rescan');
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
  capabilities?: ICamera['capabilities'];
  /** Codec + substream path captured at onboarding; drives go2rtc's `_sub` stream + transport routing. */
  media?: { codec?: string; substreamPath?: string; projection?: string };
  device?: ICamera['device'];
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

// ---- Recordings / DVR (the rolling-buffer timeline) ----

export interface IRecordingSegment {
  name: string;
  startedAt: number;
  durationMs: number;
  bytes: number;
}
export interface IRecordingGap {
  startedAt: number;
  endedAt: number;
  durationMs: number;
}
export interface IRecordingCameraTimeline {
  camera: string;
  recording: boolean;
  startedAt: number;
  endedAt: number;
  segments: IRecordingSegment[];
  gaps: IRecordingGap[];
}
export interface IRecordingTimeline {
  generatedAt: number;
  segmentSeconds: number;
  cameras: IRecordingCameraTimeline[];
}

export const fetchRecordingTimeline = (signal?: AbortSignal): Promise<IRecordingTimeline> =>
  getJson<IRecordingTimeline>('/recordings/timeline', 'recordings', signal);

/** Same-origin URL to stream a recorded segment (Range-served video/mp4). */
export const recordingUrl = (name: string): string =>
  `${API_BASE}/recordings/${encodeURIComponent(name)}`;

// ---- Incidents (evidence bundles) ----

export type TIncidentStatus = 'capturing' | 'complete' | 'partial' | 'failed';

/** The lightweight list shape (a finalized bundle has the extra fields; a capturing one does not). */
export interface IIncidentListItem {
  id: string;
  status: TIncidentStatus;
  createdAt: number;
  finalizedAt?: number;
  cameras?: string[];
  pinned?: boolean;
  assetCount?: number;
  failureCount?: number;
}

export interface IIncidentAsset {
  id: string;
  kind: 'clip' | 'snapshot' | 'telemetry';
  cameraId: string | null;
  contentType: string;
  size: number;
  sha256: string;
  name: string;
  createdAt: number;
  coverage?: {
    actualStartMs: number;
    actualEndMs: number;
    contiguous: boolean;
    segmentCount: number;
  };
}
export interface IIncidentFailure {
  kind: 'clip' | 'snapshot' | 'telemetry';
  cameraId: string | null;
  reason: string;
}
export interface IIncidentBundle {
  id: string;
  status: TIncidentStatus;
  createdAt: number;
  finalizedAt: number;
  evidence: 'best-effort';
  cameras: string[];
  assets: IIncidentAsset[];
  failures: IIncidentFailure[];
  digest: { algo: 'sha256'; value: string };
  telemetry: { coversPreRoll: boolean; positionAvailable?: boolean };
  /** What fired the capture and when — the anchor for the requested-vs-actual span. */
  trigger?: { source: string; firedAt: number; reason?: string };
  /** The requested pre/post-roll around the trigger. */
  window?: { preMs: number; postMs: number };
  label?: string;
  notes?: string;
  pinned?: boolean;
}

/** The requested capture span vs what the clips actually cover; null when nothing is comparable. */
export function incidentSpan(b: IIncidentBundle): {
  requested: { start: number; end: number };
  actual: { start: number; end: number } | null;
} | null {
  if (!b.trigger || !b.window) return null;
  const requested = {
    start: b.trigger.firedAt - b.window.preMs,
    end: b.trigger.firedAt + b.window.postMs,
  };
  const covered = b.assets
    .map((a) => a.coverage)
    .filter((c): c is NonNullable<IIncidentAsset['coverage']> => c != null);
  const actual =
    covered.length > 0
      ? {
          start: Math.min(...covered.map((c) => c.actualStartMs)),
          end: Math.max(...covered.map((c) => c.actualEndMs)),
        }
      : null;
  return { requested, actual };
}

export const fetchIncidents = (signal?: AbortSignal): Promise<IIncidentListItem[]> =>
  getJson<{ incidents: IIncidentListItem[] }>('/incidents', 'incidents', signal).then(
    (r) => r.incidents,
  );

export const fetchIncident = (id: string, signal?: AbortSignal): Promise<IIncidentBundle> =>
  getJson<IIncidentBundle>(`/incidents/${encodeURIComponent(id)}`, 'incident', signal);

/** Same-origin URL to fetch/stream an incident asset (Range-served clip / snapshot / telemetry). */
export const incidentAssetUrl = (id: string, assetId: string): string =>
  `${API_BASE}/incidents/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`;

/** Same-origin URL to download the whole bundle as a shareable .zip (manifest + README + assets). */
export const incidentExportUrl = (id: string): string =>
  `${API_BASE}/incidents/${encodeURIComponent(id)}/export.zip`;

export const setIncidentPinned = async (id: string, pinned: boolean): Promise<void> => {
  await send(
    `/incidents/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ pinned }) },
    'update incident',
  );
};

/** Delete an incident. Throws ApiError(409) when the bundle is pinned. */
export const deleteIncident = async (id: string): Promise<void> => {
  await send(`/incidents/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'delete incident');
};

// ---- Snapshots (telemetry-stamped stills) ----

export interface ISnapshot {
  id: string;
  cameraId: string;
  createdAt: number;
  size: number;
  telemetry: {
    positionAvailable: boolean;
    position: { latitude: number; longitude: number } | null;
  };
}

export const fetchSnapshots = (signal?: AbortSignal): Promise<ISnapshot[]> =>
  getJson<{ snapshots: ISnapshot[] }>('/snapshots', 'snapshots', signal).then((r) => r.snapshots);

/** Same-origin URL to the stored snapshot JPEG. */
export const snapshotUrl = (id: string): string =>
  `${API_BASE}/snapshots/${encodeURIComponent(id)}`;

// ---- Events log (durable activity feed) ----

/** One row of the durable activity feed (MOB, incident, anchor drag, camera-offline, …). */
export interface ILoggedEvent {
  id: string;
  /** Epoch ms the event was logged. */
  at: number;
  /** The notification key that produced it, e.g. `mob`, `incident`, `camera.bow.offline`. */
  type: string;
  /** Notification state at raise time (`emergency`/`alarm`/`alert`/`warn`/…), if any. */
  state?: string;
  message?: string;
}

/** Newest-first page of the event log; `before` (epoch-ms) pages strictly-older rows. */
export const fetchEvents = (
  opts: { limit?: number; before?: number; type?: string } = {},
  signal?: AbortSignal,
): Promise<ILoggedEvent[]> => {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
  if (opts.before !== undefined) qs.set('before', String(opts.before));
  if (opts.type !== undefined) qs.set('type', opts.type);
  const suffix = qs.toString() ? `?${qs}` : '';
  return getJson<{ events: ILoggedEvent[] }>(`/events/log${suffix}`, 'events', signal).then(
    (r) => r.events,
  );
};

// ---- Web Push (safety alerts) ----

/** The VAPID public key the browser needs to subscribe; null until push is configured server-side. */
export const fetchVapidPublicKey = (signal?: AbortSignal): Promise<string> =>
  getJson<{ key: string }>('/push/vapid-public-key', 'vapid', signal).then((r) => r.key);

/** Register a device's push subscription so it receives safety alerts. */
export const subscribePush = (subscription: unknown): Promise<Response> =>
  send(
    '/push/subscribe',
    { method: 'POST', body: JSON.stringify({ subscription }) },
    'push subscribe',
  );

/** Drop a device's push subscription by endpoint. */
export const unsubscribePush = (endpoint: string): Promise<Response> =>
  send(
    '/push/unsubscribe',
    { method: 'POST', body: JSON.stringify({ endpoint }) },
    'push unsubscribe',
  );

// ---- Operational config (owned by the web app; SK admin schema is empty) ----

export interface IFrigatePublicConfig {
  mqttHost?: string;
  mqttPort?: number;
  mqttTls?: boolean;
  mqttUsername?: string;
  apiUrl?: string;
  labels?: string;
  minScore?: number;
  zones?: string;
  /** Whether a broker password is stored (the value itself is never sent to the client). */
  mqttPasswordSet: boolean;
}
export interface IOperationalConfigPublic {
  hardwareTier?: string;
  autoTriggerPath?: string;
  anchorWatchPath?: string;
  mobVisualRefine?: boolean;
  frigate: IFrigatePublicConfig;
}

/** Read the current operational config (Frigate password redacted to a presence flag). */
export const fetchOperationalConfig = (signal?: AbortSignal): Promise<IOperationalConfigPublic> =>
  getJson<IOperationalConfigPublic>('/operational-config', 'config', signal);

/**
 * Save the operational config. Omit frigate.mqttPassword to keep the stored one, send a new value to
 * change it, or "" to clear it. The server persists + briefly restarts the plugin to apply.
 */
export const saveOperationalConfig = (cfg: unknown): Promise<Response> =>
  send('/operational-config', { method: 'PUT', body: JSON.stringify(cfg) }, 'save config');
