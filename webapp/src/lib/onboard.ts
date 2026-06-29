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

export interface ICameraDraft {
  id: string;
  name: string;
  role?: Role;
  mount?: Mount;
  bearingRelativeDeg?: number;
  source: { scheme: string; host: string; port?: number; path?: string };
  capabilities: { ptz: boolean; absolutePtz: boolean; audio: boolean; audioBackchannel: boolean };
}

/** Build an editable draft from an introspection result, defaulting the name from make + model. */
export function draftFromIntrospect(r: IIntrospectResult, host: string): ICameraDraft {
  const name = [r.manufacturer, r.model].filter(Boolean).join(' ').trim() || host;
  return {
    id: slugify(name),
    name,
    source: r.source ?? { scheme: 'rtsp', host },
    capabilities: {
      ptz: r.ptz === true,
      absolutePtz: r.absolutePtz === true,
      audio: r.audio === true,
      audioBackchannel: r.audioBackchannel === true,
    },
  };
}

/** Assemble the resource body to PUT — only the validator's allowed, non-credential fields. */
export function toResourceBody(d: ICameraDraft): ICameraWrite {
  const body: ICameraWrite = {
    name: d.name,
    enabled: true,
    source: d.source,
    capabilities: d.capabilities,
  };
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
