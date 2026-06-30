/**
 * Pure geometry for touch/trackpad PTZ gestures. The camera control is velocity-based (ONVIF
 * continuousMove, pan/tilt/zoom each in [-1,1]), so a drag is treated as a joystick: direction +
 * distance from the grab point set the velocity vector, and releasing stops. Keeping the math here
 * (no DOM) makes the feel unit-testable. The hook in usePtzGestures wires these to pointer events.
 */

export interface IPoint {
  x: number;
  y: number;
}

const clamp = (n: number): number => Math.max(-1, Math.min(1, n));

/** Fraction of the radius below which a drag is treated as a non-move, so a resting finger / jitter
 *  can't make the camera creep. */
const DRAG_DEADZONE = 0.12;
/** Below this fractional pinch change we don't zoom — avoids drift from a near-still two-finger hold. */
const PINCH_DEADZONE = 0.1;
/** Gain on the log-pinch so a comfortable two-finger spread reaches full zoom speed. */
const PINCH_GAIN = 1.5;
/** A discrete wheel/trackpad tick maps to a gentle zoom pulse (the hook auto-stops it shortly after). */
const WHEEL_ZOOM = 0.5;

/**
 * Map a drag delta (px from the grab origin) to a pan/tilt velocity. Right drag → pan right; dragging
 * up (negative dy) → tilt up, matching the on-screen arrows. `radius` is the distance that reaches
 * full speed. A deadzone keeps small movements at zero, then speed ramps from there to the radius.
 */
export function dragToVelocity(
  dx: number,
  dy: number,
  radius: number,
): { pan: number; tilt: number } {
  const r = radius > 0 ? radius : 1;
  const mag = Math.hypot(dx, dy) / r;
  if (mag < DRAG_DEADZONE) return { pan: 0, tilt: 0 };
  // Re-scale so velocity is 0 at the deadzone edge and 1 at the radius, then split along the drag axis.
  const ramp = Math.min(1, (mag - DRAG_DEADZONE) / (1 - DRAG_DEADZONE)) / mag;
  // `+ 0` normalises a -0 (e.g. dy=0 → -0) to 0 so callers comparing with Object.is don't trip.
  return { pan: clamp((dx / r) * ramp) + 0, tilt: clamp((-dy / r) * ramp) + 0 };
}

/**
 * Map a pinch (the finger distance when it started vs now) to a zoom velocity. Spreading the fingers
 * (current > start) zooms in (+); pinching together zooms out (−). Log-scaled so a 2× spread and a
 * ½× pinch are symmetric.
 */
export function pinchToZoom(startDist: number, currentDist: number): number {
  if (startDist <= 0 || currentDist <= 0) return 0;
  const z = Math.log2(currentDist / startDist) * PINCH_GAIN;
  if (Math.abs(z) < PINCH_DEADZONE) return 0;
  return clamp(z);
}

/** A wheel/trackpad tick → a zoom velocity. Scroll up / pinch-out (deltaY<0) zooms in. */
export function wheelToZoom(deltaY: number): number {
  if (deltaY < 0) return WHEEL_ZOOM;
  if (deltaY > 0) return -WHEEL_ZOOM;
  return 0;
}

/** Euclidean distance between two pointer positions (for pinch tracking). */
export function fingerDistance(a: IPoint, b: IPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Whether a new velocity differs enough from the last sent one to warrant another camera command. */
export function changedEnough(
  prev: { pan: number; tilt: number; zoom: number },
  next: { pan: number; tilt: number; zoom: number },
  eps = 0.06,
): boolean {
  return (
    Math.abs(next.pan - prev.pan) > eps ||
    Math.abs(next.tilt - prev.tilt) > eps ||
    Math.abs(next.zoom - prev.zoom) > eps
  );
}
