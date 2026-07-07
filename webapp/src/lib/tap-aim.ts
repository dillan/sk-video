/**
 * Geometry for single-tap-to-aim. Turns a tap at client coordinates into a normalised position within
 * the video surface and its offset from the frame centre (`dx` +right, `dy` +down) — the shape the
 * /ptz/aim endpoint expects. Because the player uses object-fit: cover the video fills the surface
 * (crop, not letterbox), so the surface rect maps directly to the visible frame — no letterbox math.
 */

export interface ITapOffset {
  /** Normalised position across the frame, 0..1. */
  nx: number;
  ny: number;
  /** Offset from the frame centre: -0.5 (left/top) … +0.5 (right/bottom). */
  dx: number;
  dy: number;
}

/** Normalise a tap to a centre-offset within an element rect, or null for a zero-size rect. */
export function tapOffset(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): ITapOffset | null {
  if (!rect.width || !rect.height) return null;
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  return { nx, ny, dx: nx - 0.5, dy: ny - 0.5 };
}
