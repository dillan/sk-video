import {
  clampPtzPosition,
  clampPtzVelocity,
  type IPtzPosition,
  type IPtzVelocity,
} from './ptz-command';

/**
 * Plans the PTZ move for a "tap a point on the video to aim there" gesture. A tap is an IMAGE-SPACE
 * offset from the frame centre — NOT a world bearing — so this is a proportional nudge toward the tapped
 * point (the same idea as {@link ../safety/mob-visual-refine.visualCorrection}), bounded per axis so a
 * stray tap can never slew the camera far. It converges the tapped point toward centre over one or two
 * taps and works on any PTZ camera; a precise one-tap centre would need the lens angle-of-view, which the
 * cameras don't report.
 *
 * Pure: no ONVIF, no I/O. The route turns the plan into an actual controller call.
 */

/** The camera's detected move capabilities. Only absolute pointing is probe-detected (via getStatus). */
export interface IAimCapabilities {
  absolutePtz: boolean;
}

/** A tap's offset from the image centre: `dx` +right, `dy` +down, each roughly in [-0.5, 0.5]. */
export interface IAimOffset {
  dx: number;
  dy: number;
}

export interface IAimOptions {
  /** Normalised move per unit of centre-offset. */
  gain?: number;
  /** Max normalised move per axis per tap — bounds a stray/edge tap. */
  maxStep?: number;
}

export type TAimOutcome = 'aimed' | 'at-limit';

/** The planned move: an absolute reposition (calibrated cameras) or a bounded relative nudge. */
export type IAimPlan =
  | { kind: 'absolute'; position: IPtzPosition; outcome: TAimOutcome }
  | { kind: 'relative'; delta: IPtzVelocity; outcome: TAimOutcome };

/** Tuning defaults. Deliberately conservative — a stray tap should nudge, not slew across the scene. */
export const DEFAULT_AIM_GAIN = 0.8;
export const DEFAULT_AIM_MAX_STEP = 0.6;

/** Bound one axis of movement to ±maxStep, coercing a non-finite input to 0 (and −0 to 0). */
function boundedStep(value: number, maxStep: number): number {
  if (!Number.isFinite(value)) return 0;
  const c = Math.max(-maxStep, Math.min(maxStep, value));
  return c === 0 ? 0 : c;
}

export function planAim(
  caps: IAimCapabilities,
  current: IPtzPosition | null,
  offset: IAimOffset,
  opts: IAimOptions = {},
): IAimPlan {
  const gain = opts.gain ?? DEFAULT_AIM_GAIN;
  const maxStep = opts.maxStep ?? DEFAULT_AIM_MAX_STEP;
  const dx = Number.isFinite(offset.dx) ? offset.dx : 0;
  const dy = Number.isFinite(offset.dy) ? offset.dy : 0;
  // ONVIF convention (mirrors visualCorrection): +pan = right, +tilt = up. A point right of centre
  // (dx > 0) pans right; a point below centre (dy > 0) tilts DOWN, hence −dy. Bounded per axis so a
  // stray/edge tap can only nudge, never slew across the scene.
  const stepPan = boundedStep(dx * gain, maxStep);
  const stepTilt = boundedStep(-dy * gain, maxStep);

  // Absolute pointing (calibrated PTZ): reposition from where the camera is now. Precise and
  // self-completing. Clamping past the mechanical range is reported as at-limit, matching MOB.
  if (caps.absolutePtz && current) {
    const rawPan = current.pan + stepPan;
    const rawTilt = current.tilt + stepTilt;
    const position = clampPtzPosition({ pan: rawPan, tilt: rawTilt, zoom: current.zoom });
    const outcome: TAimOutcome =
      position.pan !== rawPan || position.tilt !== rawTilt ? 'at-limit' : 'aimed';
    return { kind: 'absolute', position, outcome };
  }

  // Otherwise a self-completing relative nudge toward the tapped point (no calibration needed).
  const delta = clampPtzVelocity({ pan: stepPan, tilt: stepTilt, zoom: 0 });
  return { kind: 'relative', delta, outcome: 'aimed' };
}
