import type { ICamera } from '../api';
import { formatBearing } from './format';

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
