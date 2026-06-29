import type { ICandidate, IIntrospectResult, ICameraWrite } from '../api';

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
  };
  /** Main-stream codec + the H.264 substream path captured by introspection (drives live routing). */
  media?: { codec?: string; substreamPath?: string };
  /** Read-only: the media profiles introspection found, surfaced in the wizard (never persisted). */
  streams?: { codec: string; width?: number; height?: number }[];
}

/** Build an editable draft from an introspection result, defaulting the name from make + model. */
export function draftFromIntrospect(r: IIntrospectResult, host: string): ICameraDraft {
  const name = [r.manufacturer, r.model].filter(Boolean).join(' ').trim() || host;
  const media: { codec?: string; substreamPath?: string } = {};
  if (r.codec && RESOURCE_CODECS.has(r.codec)) {
    media.codec = r.codec;
  }
  // A substream is only usable if its path is one the resource validator accepts; otherwise drop it so
  // the camera still saves. The capability tracks the path exactly — never claim a sub we can't store.
  const hasSub = !!r.substreamPath && r.substreams === true && isSafeMediaPath(r.substreamPath);
  if (hasSub) {
    media.substreamPath = r.substreamPath;
  }
  const draft: ICameraDraft = {
    id: slugify(name),
    name,
    source: r.source ?? { scheme: 'rtsp', host },
    capabilities: {
      ptz: r.ptz === true,
      absolutePtz: r.absolutePtz === true,
      audio: r.audio === true,
      audioBackchannel: r.audioBackchannel === true,
      substreams: hasSub,
    },
  };
  if (media.codec || media.substreamPath) {
    draft.media = media;
  }
  if (r.streams && r.streams.length > 0) {
    draft.streams = r.streams.map((s) => ({ codec: s.codec, width: s.width, height: s.height }));
  }
  return draft;
}

/** Assemble the resource body to PUT — only the validator's allowed, non-credential fields. */
export function toResourceBody(d: ICameraDraft): ICameraWrite {
  const body: ICameraWrite = {
    name: d.name,
    enabled: true,
    source: d.source,
    capabilities: d.capabilities,
  };
  if (d.media && (d.media.codec || d.media.substreamPath)) {
    body.media = d.media;
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
