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

export type TileState = 'disabled' | 'connecting';

export interface ITileView {
  state: TileState;
  /** Chip label shown top-left on the tile. */
  label: string;
  /** Whether the tile renders dimmed (disabled). */
  dim: boolean;
}

export function cameraTileView(c: ICamera): ITileView {
  if (!c.enabled) {
    return { state: 'disabled', label: 'Disabled', dim: true };
  }
  return { state: 'connecting', label: 'Connecting…', dim: false };
}
