import type { ICandidate, IIntrospectResult, ICameraWrite, ICameraEntry } from '../api';

/** Vessel mounts + roles (mirrors the plugin's closed enums so dropdowns produce valid values). */
export const MOUNTS = [
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
export const ROLES = [
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
export type Mount = (typeof MOUNTS)[number];
export type Role = (typeof ROLES)[number];

/** True for a genuine ONVIF camera (its service path is `/onvif/...`), vs a WSD responder like a NAS. */
export function isOnvifCandidate(c: ICandidate): boolean {
  return typeof c.onvifUrl === 'string' && /\/onvif\//i.test(c.onvifUrl);
}

/** Rank real ONVIF cameras first; other WSD hits sink to the bottom (dismissible noise). Stable. */
export function rankCandidates(cands: ICandidate[]): ICandidate[] {
  return cands
    .map((c, i) => ({ c, i, onvif: isOnvifCandidate(c) }))
    .sort((a, b) => Number(b.onvif) - Number(a.onvif) || a.i - b.i)
    .map((x) => x.c);
}

/** A URL-safe camera id. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'camera'
  );
}

export function isValidSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(s) && s.length <= 64;
}

/** Codecs the camera resource accepts for media.codec (mirrors the plugin's CAMERA_CODECS allow-list). */
const RESOURCE_CODECS = new Set(['h264', 'h265', 'mjpeg']);

/** The camera-resource validator's safe-path rule (mirrors PATH_RE in camera-validation). An unsafe
 * substream path (e.g. one carrying a query string) would 400 the WHOLE save, so we drop it instead —
 * the camera still onboards, just without a substream. */
const SAFE_PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/;
const isSafeMediaPath = (p: string): boolean => SAFE_PATH_RE.test(p) && !p.includes('..');

export interface ICameraDraft {
  id: string;
  name: string;
  /** Edit mode carries the stored enabled state so an edit never silently re-enables a camera;
   *  the add flow leaves it unset (a new camera saves enabled). */
  enabled?: boolean;
  role?: Role;
  mount?: Mount;
  bearingRelativeDeg?: number;
  source: { scheme: string; host: string; port?: number; path?: string };
  capabilities: {
    ptz: boolean;
    absolutePtz: boolean;
    audio: boolean;
    audioBackchannel: boolean;
    substreams: boolean;
    spotlight?: boolean;
    alarm?: boolean;
    imaging?: string[];
    auxCommands?: string[];
  };
  /** Main-stream codec + the H.264 substream path captured by introspection (drives live routing). */
  media?: { codec?: string; substreamPath?: string };
  /** Device identity + firmware captured by introspection (durable identity; firmware-change detection). */
  device?: { manufacturer?: string; model?: string; serial?: string; firmware?: string };
  /** Read-only: the media profiles introspection found, surfaced in the wizard (never persisted). */
  streams?: { codec: string; width?: number; height?: number }[];
}

/** The discovered fields an introspection produces — capabilities, media, and device identity — shared
 *  by first-time onboarding and a later re-scan so both stay consistent. */
export function capabilitiesFromIntrospect(r: IIntrospectResult): ICameraDraft['capabilities'] {
  // A substream is only usable if its path is one the resource validator accepts; otherwise drop it so
  // the camera still saves. The capability tracks the path exactly — never claim a sub we can't store.
  const hasSub = !!r.substreamPath && r.substreams === true && isSafeMediaPath(r.substreamPath);
  return {
    ptz: r.ptz === true,
    absolutePtz: r.absolutePtz === true,
    audio: r.audio === true,
    audioBackchannel: r.audioBackchannel === true,
    substreams: hasSub,
    spotlight: r.spotlight === true,
    alarm: r.alarm === true,
    // The imaging controls the camera exposes (irCut, brightness, …). The plugin only reports names its
    // resource validator accepts, so they persist as-is and drive the "Imaging" capability badge.
    ...(r.imaging && r.imagingControls.length ? { imaging: r.imagingControls } : {}),
    ...(r.auxCommands && r.auxCommands.length ? { auxCommands: r.auxCommands } : {}),
  };
}

export function mediaFromIntrospect(r: IIntrospectResult): {
  codec?: string;
  substreamPath?: string;
} {
  const media: { codec?: string; substreamPath?: string } = {};
  if (r.codec && RESOURCE_CODECS.has(r.codec)) {
    media.codec = r.codec;
  }
  if (!!r.substreamPath && r.substreams === true && isSafeMediaPath(r.substreamPath)) {
    media.substreamPath = r.substreamPath;
  }
  return media;
}

/**
 * Whether a camera-reported serial is a durable identity. Some vendors report their IP address (or
 * nothing) as the serial — persisting that as identity breaks dedupe the moment DHCP moves the
 * camera, so such serials are dropped and identity falls back to manufacturer+model.
 */
export function isStableSerial(serial: string): boolean {
  const trimmed = serial.trim();
  if (trimmed === '') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return false; // IPv4-shaped
  if (trimmed.includes(':') && /^[0-9a-f:.]+$/i.test(trimmed)) {
    const groups = trimmed.split(':');
    // A MAC (six 2-hex-digit groups) IS a durable identity; other colon-hex is IPv6-shaped.
    const isMac = groups.length === 6 && groups.every((g) => /^[0-9a-f]{2}$/i.test(g));
    if (!isMac) return false;
  }
  return true;
}

/** Device identity (durable id + firmware) from the scan, when the camera reported any of it. */
export function deviceFromIntrospect(
  r: IIntrospectResult,
): { manufacturer?: string; model?: string; serial?: string; firmware?: string } | undefined {
  const device: { manufacturer?: string; model?: string; serial?: string; firmware?: string } = {};
  if (r.manufacturer) device.manufacturer = r.manufacturer;
  if (r.model) device.model = r.model;
  if (r.serialNumber !== undefined && isStableSerial(String(r.serialNumber))) {
    device.serial = String(r.serialNumber);
  }
  if (r.firmwareVersion) device.firmware = r.firmwareVersion;
  return Object.keys(device).length ? device : undefined;
}

/** Build an editable draft from an introspection result, defaulting the name from make + model. */
export function draftFromIntrospect(r: IIntrospectResult, host: string): ICameraDraft {
  const name = [r.manufacturer, r.model].filter(Boolean).join(' ').trim() || host;
  const media = mediaFromIntrospect(r);
  const device = deviceFromIntrospect(r);
  const draft: ICameraDraft = {
    id: slugify(name),
    name,
    source: r.source ?? { scheme: 'rtsp', host },
    capabilities: capabilitiesFromIntrospect(r),
  };
  if (media.codec || media.substreamPath) {
    draft.media = media;
  }
  if (device) {
    draft.device = device;
  }
  if (r.streams && r.streams.length > 0) {
    draft.streams = r.streams.map((s) => ({ codec: s.codec, width: s.width, height: s.height }));
  }
  return draft;
}

/**
 * Merge a re-scan into an existing camera: refresh the discovered fields (capabilities, media, device)
 * while preserving every operator-set field (name, role, placement, calibration, safety flag, source).
 * The whole resource is spread through, so fields the web app doesn't model (e.g. calibration) survive.
 */
export function mergeRescan(existing: ICameraEntry, r: IIntrospectResult): ICameraWrite {
  const { id: _id, ...rest } = existing as ICameraEntry & Record<string, unknown>;
  void _id;
  const media = mediaFromIntrospect(r);
  const device = deviceFromIntrospect(r);
  const existingMedia = (rest.media ?? {}) as { projection?: string };
  return {
    ...rest,
    capabilities: capabilitiesFromIntrospect(r),
    // Refresh codec/substream from the scan; keep a projection (360 geometry) the operator may have set.
    ...(media.codec || media.substreamPath || existingMedia.projection
      ? {
          media: {
            ...media,
            ...(existingMedia.projection ? { projection: existingMedia.projection } : {}),
          },
        }
      : {}),
    ...(device ? { device } : {}),
  } as ICameraWrite;
}

/**
 * Build an editable draft from a stored camera, for the edit flow (no discovery to draft from).
 * A stored role/mount outside the closed enums falls back to unset so the dropdowns stay valid;
 * capabilities/media/device ride along for display only — {@link mergeEdit} keeps the stored ones.
 */
export function draftFromEntry(entry: ICameraEntry): ICameraDraft {
  const caps = entry.capabilities ?? {};
  const draft: ICameraDraft = {
    id: entry.id,
    name: entry.name,
    enabled: entry.enabled,
    source: entry.source ? { ...entry.source } : { scheme: 'rtsp', host: '' },
    capabilities: {
      ptz: caps.ptz === true,
      absolutePtz: caps.absolutePtz === true,
      audio: caps.audio === true,
      audioBackchannel: caps.audioBackchannel === true,
      substreams: caps.substreams === true,
      ...(caps.spotlight !== undefined ? { spotlight: caps.spotlight } : {}),
      ...(caps.alarm !== undefined ? { alarm: caps.alarm } : {}),
      ...(caps.imaging ? { imaging: caps.imaging } : {}),
      ...(caps.auxCommands ? { auxCommands: caps.auxCommands } : {}),
    },
  };
  if (entry.role && (ROLES as readonly string[]).includes(entry.role)) {
    draft.role = entry.role as Role;
  }
  const mount = entry.placement?.mount;
  if (mount && (MOUNTS as readonly string[]).includes(mount)) {
    draft.mount = mount as Mount;
  }
  if (typeof entry.placement?.bearingRelativeDeg === 'number') {
    draft.bearingRelativeDeg = entry.placement.bearingRelativeDeg;
  }
  if (entry.media && (entry.media.codec || entry.media.substreamPath)) {
    draft.media = { codec: entry.media.codec, substreamPath: entry.media.substreamPath };
  }
  if (entry.device) {
    draft.device = entry.device;
  }
  return draft;
}

/**
 * Merge the edit form back into an existing camera. Only the fields the form edits (name, enabled,
 * source, role, mount, bearing) are replaced; everything else in the stored resource — capabilities,
 * media (incl. projection), device, and fields the web app doesn't model (calibration, the safety
 * flag) — is spread through verbatim, so an edit can never destroy a calibration. Same philosophy
 * as {@link mergeRescan}. The caller PUTs to the EXISTING id — an edit never mints a new camera.
 */
export function mergeEdit(existing: ICameraEntry, d: ICameraDraft): ICameraWrite {
  const { id: _id, ...rest } = existing as ICameraEntry & Record<string, unknown>;
  void _id;
  const body = {
    ...rest,
    name: d.name,
    enabled: d.enabled ?? existing.enabled,
    source: d.source,
  } as ICameraWrite & Record<string, unknown>;
  if (d.role) body.role = d.role;
  else delete body.role;
  // Rebuild mount/bearing from the form, keeping placement fields the form doesn't edit (heightM).
  const placement = { ...(existing.placement ?? {}) } as Record<string, unknown>;
  delete placement.mount;
  delete placement.bearingRelativeDeg;
  if (d.mount) placement.mount = d.mount;
  if (typeof d.bearingRelativeDeg === 'number' && Number.isFinite(d.bearingRelativeDeg)) {
    placement.bearingRelativeDeg = d.bearingRelativeDeg;
  }
  if (Object.keys(placement).length > 0) body.placement = placement as ICameraWrite['placement'];
  else delete body.placement;
  return body;
}

/** Assemble the resource body to PUT — only the validator's allowed, non-credential fields. */
export function toResourceBody(d: ICameraDraft): ICameraWrite {
  const body: ICameraWrite = {
    name: d.name,
    enabled: d.enabled ?? true,
    source: d.source,
    capabilities: d.capabilities,
  };
  if (d.media && (d.media.codec || d.media.substreamPath)) {
    body.media = d.media;
  }
  if (d.device) {
    body.device = d.device;
  }
  if (d.role) {
    body.role = d.role;
  }
  const placement: { mount?: string; bearingRelativeDeg?: number } = {};
  if (d.mount) {
    placement.mount = d.mount;
  }
  if (typeof d.bearingRelativeDeg === 'number' && Number.isFinite(d.bearingRelativeDeg)) {
    placement.bearingRelativeDeg = d.bearingRelativeDeg;
  }
  if (Object.keys(placement).length > 0) {
    body.placement = placement;
  }
  return body;
}
