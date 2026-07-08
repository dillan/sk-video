import type { ICamera, IStreamHealth, TTransport } from '../api';
import { formatBearing, formatClock } from './format';

/**
 * Pure camera-tile derivations for the Live Wall. An enabled tile plays its sub-stream and labels the
 * live transport itself; this covers the resource-only fallback states: a disabled camera, and an
 * enabled one before its player reports a rung. The richer health states from the design (reconnecting
 * / went dark / never seen) land when stream health is wired in — we don't fabricate a confirmed state.
 */

/** "Bow · 350° · substream" — built from placement + capabilities, omitting whatever is unknown. */
export function cameraSubtitle(c: ICamera): string {
  const parts: string[] = [];
  const mount = c.placement?.mount;
  if (mount) {
    parts.push(mount.charAt(0).toUpperCase() + mount.slice(1));
  }
  if (typeof c.placement?.bearingRelativeDeg === 'number') {
    parts.push(formatBearing(c.placement.bearingRelativeDeg));
  }
  if (c.capabilities?.substreams) {
    parts.push('substream');
  }
  return parts.join(' · ');
}

/** A discovered-capability badge for the camera-management list. */
export interface ICapabilityBadge {
  key: string;
  /** Short glanceable label. */
  label: string;
  /** Fuller description for the title tooltip. */
  title: string;
  /** 'caution' flags a cost/limitation (e.g. an H.265 camera the server must transcode); default info. */
  tone?: 'info' | 'caution';
}

/**
 * The capabilities a camera reports from ONVIF discovery, as compact badges for the management list —
 * so an operator can see at a glance what each camera can do. Only supported capabilities produce a
 * badge (never a "not supported" chip); a plain RTSP camera simply shows none.
 */
export function capabilityBadges(c: ICamera): ICapabilityBadge[] {
  const caps = c.capabilities;
  if (!caps) return [];
  const badges: ICapabilityBadge[] = [];
  if (caps.ptz || caps.absolutePtz) {
    badges.push({
      key: 'ptz',
      label: 'PTZ',
      title: caps.absolutePtz ? 'Pan/tilt/zoom with absolute pointing' : 'Pan/tilt/zoom',
    });
  }
  if (caps.imaging && caps.imaging.length > 0) {
    badges.push({ key: 'imaging', label: 'Imaging', title: 'Day/Night/Fog/Glare vision presets' });
  }
  if (caps.audio) {
    badges.push({ key: 'audio', label: 'Audio', title: 'Camera audio (listen)' });
  }
  if (caps.audioBackchannel) {
    badges.push({ key: 'talk', label: 'Two-way', title: 'Two-way audio (talk to the camera)' });
  }
  if (caps.substreams) {
    badges.push({ key: 'sub', label: 'H.264 sub', title: 'Low-latency H.264 substream' });
  } else if (c.media?.codec === 'h265') {
    // H.265 with no H.264 substream: browsers can't decode it live, so the server software-transcodes
    // it (heavy on a Pi). Flag it so the operator can add an H.264 substream on the camera.
    badges.push({
      key: 'transcode',
      label: 'H.265 · transcodes',
      title:
        'H.265 with no H.264 sub-stream — live view is software-transcoded (heavy CPU). Add an H.264 sub-stream on the camera for smooth, low-CPU playback.',
      tone: 'caution',
    });
  }
  if (caps.spotlight) {
    badges.push({ key: 'spotlight', label: 'Spotlight', title: 'White-light spotlight' });
  }
  if (caps.alarm) {
    badges.push({ key: 'alarm', label: 'Alarm', title: 'Audible alarm / siren' });
  }
  if (caps.sensors?.includes('bearing')) {
    badges.push({ key: 'compass', label: 'Compass', title: 'Reports its own compass bearing' });
  }
  return badges;
}

export type TileTone = 'live' | 'neutral' | 'caution';

export interface ITileStatus {
  /** Chip label shown top-left on the tile. */
  label: string;
  /** Chip tone — `live` gets the recording/online treatment + a pulsing dot. */
  tone: TileTone;
  /** True only when a real frame is flowing (drives the live dot). */
  live: boolean;
  /** Whether the tile renders dimmed (disabled). */
  dim: boolean;
}

/**
 * The honest tile status, driven by the player's own activity rather than go2rtc's internals (go2rtc
 * connects lazily, so its "online" flag can't tell never-seen from idle). `active` is true once a real
 * frame is playing; `signalLost` is set after a grace period with no frame — so a dead camera reads as
 * "No signal" instead of "Connecting…" forever (the same trap as a status that can't go down).
 */
export function tileStatus(c: ICamera, active: boolean, signalLost: boolean): ITileStatus {
  if (!c.enabled) {
    return { label: 'Disabled', tone: 'neutral', live: false, dim: true };
  }
  if (active) {
    return { label: 'Live', tone: 'live', live: true, dim: false };
  }
  if (signalLost) {
    return { label: 'No signal', tone: 'caution', live: false, dim: false };
  }
  return { label: 'Connecting…', tone: 'neutral', live: false, dim: false };
}

export interface IHealthPresence {
  label: string;
  tone: 'live' | 'neutral' | 'caution';
}

/**
 * The server-tracked presence tri-state for diagnostics: producing now, went dark (was live, with
 * when), or never seen producing since the server started tracking. go2rtc connects lazily, so
 * "never seen" usually means idle-with-no-viewer, not a fault — the copy stays neutral. An older
 * server without last-good tracking falls back to the plain idle label.
 */
export function healthPresence(h: IStreamHealth): IHealthPresence {
  if (h.online) {
    return { label: 'producing', tone: 'live' };
  }
  if (typeof h.lastGoodAt === 'number') {
    return { label: `went dark — last seen live ${formatClock(h.lastGoodAt)}`, tone: 'caution' };
  }
  if (h.lastGoodAt === null && typeof h.trackedSince === 'number') {
    return {
      label: `idle — never seen producing since ${formatClock(h.trackedSince)}`,
      tone: 'neutral',
    };
  }
  return { label: 'idle — no active producer', tone: 'neutral' };
}

/** A tile's coarse state for the Live Wall header tally. */
export type TileCategory = 'live' | 'stillRefresh' | 'reconnecting' | 'offline';

/**
 * Collapse a tile's player state into one tally category. A disabled camera or a dead feed (no frame
 * past the grace period) is `offline`; a flowing MJPEG still-refresh is its own honest category; any
 * other flowing frame is `live`; otherwise it's still `reconnecting`.
 */
export function tileCategory(
  c: ICamera,
  active: boolean,
  signalLost: boolean,
  rung: TTransport,
): TileCategory {
  if (!c.enabled || signalLost) return 'offline';
  if (active) return rung === 'mjpeg' ? 'stillRefresh' : 'live';
  return 'reconnecting';
}

/** Build the design's "2 live · 1 still-refresh · 1 reconnecting · 1 offline" summary, omitting zeros. */
export function summarizeCategories(cats: TileCategory[]): string {
  const n = { live: 0, stillRefresh: 0, reconnecting: 0, offline: 0 };
  for (const c of cats) n[c] += 1;
  const parts: string[] = [];
  if (n.live) parts.push(`${n.live} live`);
  if (n.stillRefresh) parts.push(`${n.stillRefresh} still-refresh`);
  if (n.reconnecting) parts.push(`${n.reconnecting} reconnecting`);
  if (n.offline) parts.push(`${n.offline} offline`);
  return parts.join(' · ');
}
