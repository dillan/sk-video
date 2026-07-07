import { clampPtzVelocity, type IPtzPosition, type IPtzVelocity } from './ptz-command';

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

export function planAim(
  _caps: IAimCapabilities,
  _current: IPtzPosition | null,
  _offset: IAimOffset,
  _opts: IAimOptions = {},
): IAimPlan {
  // Not implemented yet (RED): a placeholder that discriminates from every expected behaviour.
  return { kind: 'relative', delta: clampPtzVelocity(null), outcome: 'aimed' };
}
