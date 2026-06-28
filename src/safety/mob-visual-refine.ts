/**
 * EXPERIMENTAL, NON-SAFETY-RATED visual man-overboard refinement (A1). It consumes a person detection
 * (e.g. from a user-run Frigate, C4) and emits only a SMALL, BOUNDED relativeMove correction that is
 * layered ON TOP of the MOB controller's authoritative absoluteMove geo-pointing (C2). Geo-pointing
 * remains the baseline and reasserts on every re-aim cycle; this just nudges toward the detected
 * person between cycles. It is OFF by default and FAILS SAFE: on track loss (no confident detection
 * within a timeout) it raises a Signal K notification ("reverting to position-based aim") and stops
 * correcting, leaving pure geo-pointing — which is the live MOB-beacon position when one exists. It is
 * documented to fail holding a ~5 px person on monotone water and can lock onto a wake/whitecap, so it
 * never silently takes over the camera and makes no safety claim.
 *
 * Loss is tracked as a SINGLE coarse latch ("have we seen any confident person recently"), not per
 * camera — on a multi-camera boat a confident person on any refined camera keeps the track alive. That
 * is an intentional simplification for an experimental, fail-safe assist; per-camera latching is future
 * work. Each camera still only ever nudges toward its own detection.
 */

import type { IFrigateEventMessage } from '../analytics/frigate-events';

const DEFAULT_GAIN = 0.5;
const DEFAULT_MAX_STEP = 0.15; // hard ceiling on a single correction (normalised ONVIF units)
const DEFAULT_MIN_SCORE = 0.6;
const DEFAULT_LOSS_TIMEOUT_MS = 4000;
// The authoritative geo re-aim (absoluteMove) re-centres the camera roughly every position delta. We
// rate-limit our nudges to no more than one per this interval so a burst of Frigate detections can't
// stack relativeMove steps faster than the baseline re-centres them — bounding total visual drift.
const DEFAULT_MIN_CORRECTION_INTERVAL_MS = 750;

export const VISUAL_LOST_MESSAGE = 'Visual tracking lost — reverting to position-based aim.';

export interface IVisualDetection {
  /** Detected target centre, frame ratios 0..1 (0,0 = top-left). */
  centerX: number;
  centerY: number;
  score: number;
}

export interface IRefineCorrection {
  pan: number;
  tilt: number;
}

export interface IMobVisualRefineDeps {
  /** Raise the "visual tracking lost" notification (fail-safe banner). */
  raiseNotification: (message: string) => void;
  clearNotification: () => void;
  gain?: number;
  maxStep?: number;
  minScore?: number;
  lossTimeoutMs?: number;
  minCorrectionIntervalMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * A bounded relativeMove correction to centre a normalised detection. ONVIF convention: +pan = right,
 * +tilt = up. A target right of centre pans right; below centre tilts down. Always clamped to maxStep.
 */
export function visualCorrection(
  detection: IVisualDetection,
  gain: number,
  maxStep: number,
): IRefineCorrection {
  const dx = detection.centerX - 0.5;
  const dy = detection.centerY - 0.5;
  const clamp = (v: number): number => {
    const c = Math.max(-maxStep, Math.min(maxStep, v));
    return c === 0 ? 0 : c; // normalise -0 to 0
  };
  return { pan: clamp(dx * gain), tilt: clamp(-dy * gain) };
}

/**
 * Centre of a Frigate-style box [x, y, w, h] expected as NORMALISED ratios (0..1, top-left origin), or
 * null if it is malformed OR falls outside the unit frame. A box outside [0,1] is almost certainly pixel
 * coordinates from a Frigate build that doesn't normalise; we can't convert it without the frame size,
 * so we REJECT it (the refine no-ops and geo-pointing stays in control) rather than clamp it to a corner
 * and slew the camera there on a format mismatch.
 */
export function detectionCenter(box: unknown): { centerX: number; centerY: number } | null {
  if (
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return null;
  }
  const [x, y, w, h] = box as number[];
  const EPS = 1e-6;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 + EPS || y + h > 1 + EPS) {
    return null;
  }
  return { centerX: x + w / 2, centerY: y + h / 2 };
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Extract a usable person detection from a parsed Frigate event, or null. Applies the same honesty
 * filters as the intrusion path before the refine ever moves a camera: skip 'end' (object-gone) events
 * and Frigate-flagged false positives, require a 'person' label, coerce the score to a finite number
 * (so NaN/Infinity can't slip past the confidence gate), and require a normalised box.
 */
export function frigatePersonDetection(
  msg: IFrigateEventMessage,
): { camera: string; detection: IVisualDetection } | null {
  if (msg.type === 'end' || msg.after.label !== 'person') {
    return null;
  }
  if ((msg.after as { false_positive?: unknown }).false_positive === true) {
    return null;
  }
  const center = detectionCenter(msg.after.box);
  if (!center) {
    return null;
  }
  const score = Math.max(finiteOrZero(msg.after.top_score), finiteOrZero(msg.after.score));
  return { camera: msg.after.camera, detection: { ...center, score } };
}

export class MobVisualRefine {
  private active = false;
  private lost = false;
  private lastGoodAt = 0;
  private lastCorrectionAt = Number.NEGATIVE_INFINITY;
  private readonly gain: number;
  private readonly maxStep: number;
  private readonly minScore: number;
  private readonly lossTimeoutMs: number;
  private readonly minCorrectionIntervalMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: IMobVisualRefineDeps) {
    this.gain = deps.gain ?? DEFAULT_GAIN;
    this.maxStep = deps.maxStep ?? DEFAULT_MAX_STEP;
    this.minScore = deps.minScore ?? DEFAULT_MIN_SCORE;
    this.lossTimeoutMs = deps.lossTimeoutMs ?? DEFAULT_LOSS_TIMEOUT_MS;
    this.minCorrectionIntervalMs =
      deps.minCorrectionIntervalMs ?? DEFAULT_MIN_CORRECTION_INTERVAL_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Begin refining (MOB activated AND the experimental toggle is on). */
  activate(): void {
    // Re-activating while a "lost" banner is still up must clear it, or the banner is orphaned: once
    // lost is reset to false, neither recovery, deactivate, nor stop (all guarded by `if (this.lost)`)
    // can ever clear it — leaving a stuck alert that wrongly says we reverted to geo-pointing.
    if (this.lost) {
      this.deps.clearNotification();
    }
    this.active = true;
    this.lost = false;
    this.lastGoodAt = this.now();
    this.lastCorrectionAt = Number.NEGATIVE_INFINITY;
  }

  /** Stop refining and clear any outstanding "lost" banner. Pure geo-pointing resumes (C2). */
  deactivate(): void {
    if (this.lost) {
      this.deps.clearNotification();
    }
    this.active = false;
    this.lost = false;
  }

  isActive(): boolean {
    return this.active;
  }

  isLost(): boolean {
    return this.lost;
  }

  /**
   * Process a detection. Returns a bounded relativeMove correction, or null when it doesn't qualify
   * (inactive, below the confidence threshold, or rate-limited). A confident detection always keeps the
   * track alive and recovers a lost one — the rate limit only throttles the camera nudge, not the latch.
   */
  onDetection(detection: IVisualDetection): IRefineCorrection | null {
    if (!this.active || detection.score < this.minScore) {
      return null;
    }
    const now = this.now();
    this.lastGoodAt = now;
    if (this.lost) {
      this.lost = false;
      this.deps.clearNotification();
      this.deps.log?.('visual MOB track recovered');
    }
    // Throttle the actual camera nudge so corrections can't outpace (and so overpower) the authoritative
    // geo re-aim that re-centres between them. The detection above already kept the track alive.
    if (now - this.lastCorrectionAt < this.minCorrectionIntervalMs) {
      return null;
    }
    this.lastCorrectionAt = now;
    return visualCorrection(detection, this.gain, this.maxStep);
  }

  /** Periodic check: declare track loss ONCE if no confident detection arrived within the timeout. */
  checkTrackLoss(): void {
    if (!this.active || this.lost) {
      return;
    }
    if (this.now() - this.lastGoodAt > this.lossTimeoutMs) {
      this.lost = true;
      this.deps.raiseNotification(VISUAL_LOST_MESSAGE);
      this.deps.log?.('visual MOB track lost; reverting to geo-pointing');
    }
  }
}
