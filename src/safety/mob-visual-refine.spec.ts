import { describe, it, expect } from 'vitest';
import {
  MobVisualRefine,
  visualCorrection,
  detectionCenter,
  frigatePersonDetection,
  VISUAL_LOST_MESSAGE,
  type IMobVisualRefineDeps,
} from './mob-visual-refine';
import type { IFrigateEventMessage } from '../analytics/frigate-events';

describe('visualCorrection', () => {
  it('nudges toward an off-centre target, bounded to maxStep', () => {
    // Target hard to the lower-right; gain 1 would give 0.4/-0.4 but maxStep caps it.
    const c = visualCorrection({ centerX: 0.9, centerY: 0.9, score: 1 }, 1, 0.15);
    expect(c.pan).toBeCloseTo(0.15, 5); // right -> +pan, clamped
    expect(c.tilt).toBeCloseTo(-0.15, 5); // below -> -tilt, clamped
  });

  it('is zero for a centred target and signs correctly for upper-left', () => {
    expect(visualCorrection({ centerX: 0.5, centerY: 0.5, score: 1 }, 0.5, 0.15)).toEqual({
      pan: 0,
      tilt: 0,
    });
    const upperLeft = visualCorrection({ centerX: 0.3, centerY: 0.2, score: 1 }, 0.5, 1);
    expect(upperLeft.pan).toBeLessThan(0); // left -> -pan
    expect(upperLeft.tilt).toBeGreaterThan(0); // above -> +tilt
  });

  it('normalises a -0 component to +0 (a centred axis must compare equal to 0)', () => {
    const c = visualCorrection({ centerX: 0.5, centerY: 0.5, score: 1 }, 0.5, 0.15);
    expect(Object.is(c.pan, -0)).toBe(false);
    expect(Object.is(c.tilt, -0)).toBe(false);
  });
});

describe('detectionCenter', () => {
  it('computes the centre of a normalised [x,y,w,h] ratio box', () => {
    expect(detectionCenter([0.4, 0.4, 0.2, 0.2])).toEqual({ centerX: 0.5, centerY: 0.5 });
    expect(detectionCenter([0.8, 0.8, 0.2, 0.2])).toEqual({ centerX: 0.9, centerY: 0.9 }); // edge
  });

  it('returns null for a malformed box', () => {
    expect(detectionCenter([0.1, 0.2])).toBeNull();
    expect(detectionCenter('nope')).toBeNull();
    expect(detectionCenter([0.1, 0.2, 0.3, 'x'])).toBeNull();
    expect(detectionCenter([0.1, 0.2, 0.3, NaN])).toBeNull();
  });

  it('REJECTS an out-of-frame / pixel-coordinate box instead of clamping it to a corner', () => {
    // A box exceeding the unit frame is almost certainly pixels from a non-normalising Frigate; we must
    // not turn it into a confident "bottom-right" detection that slews the camera to the corner.
    expect(detectionCenter([0.9, 0.9, 0.4, 0.4])).toBeNull(); // x+w = 1.3 > 1
    expect(detectionCenter([320, 240, 40, 80])).toBeNull(); // pixel coordinates
    expect(detectionCenter([-0.1, 0.2, 0.3, 0.3])).toBeNull(); // negative origin
    expect(detectionCenter([0.2, 0.2, 0, 0.3])).toBeNull(); // zero-width
  });
});

function event(over: Partial<IFrigateEventMessage['after']> & { type?: 'new' | 'update' | 'end' }) {
  const { type = 'update', ...after } = over;
  return {
    type,
    after: {
      id: 'evt-1',
      camera: 'foredeck',
      label: 'person',
      box: [0.4, 0.4, 0.2, 0.2],
      top_score: 0.8,
      ...after,
    },
  } as IFrigateEventMessage;
}

describe('frigatePersonDetection', () => {
  it('extracts a person detection with its centre + the higher of score/top_score', () => {
    const found = frigatePersonDetection(event({ top_score: 0.7, score: 0.9 }));
    expect(found).toEqual({
      camera: 'foredeck',
      detection: { centerX: 0.5, centerY: 0.5, score: 0.9 },
    });
  });

  it('skips non-person labels, end (object-gone) events, and Frigate-flagged false positives', () => {
    expect(frigatePersonDetection(event({ label: 'car' }))).toBeNull();
    expect(frigatePersonDetection(event({ type: 'end' }))).toBeNull();
    expect(frigatePersonDetection(event({ false_positive: true }))).toBeNull();
  });

  it('coerces a non-finite score to 0 so it cannot bypass the confidence gate', () => {
    const found = frigatePersonDetection(event({ top_score: NaN, score: Infinity }));
    expect(found!.detection.score).toBe(0);
  });

  it('returns null when the box is not a normalised ratio box', () => {
    expect(frigatePersonDetection(event({ box: [320, 240, 40, 80] }))).toBeNull();
    expect(frigatePersonDetection(event({ box: undefined }))).toBeNull();
  });
});

function setup(over: Partial<IMobVisualRefineDeps> = {}) {
  const calls = { raised: [] as string[], cleared: 0 };
  let clock = 1000;
  const refine = new MobVisualRefine({
    raiseNotification: (m) => calls.raised.push(m),
    clearNotification: () => (calls.cleared += 1),
    minScore: 0.6,
    maxStep: 0.15,
    gain: 0.5,
    lossTimeoutMs: 4000,
    minCorrectionIntervalMs: 0, // no throttle by default; the throttle test sets its own interval
    now: () => clock,
    ...over,
  });
  return { refine, calls, setClock: (t: number) => (clock = t) };
}

describe('MobVisualRefine', () => {
  it('only corrects while active and above the confidence threshold', () => {
    const { refine } = setup();
    expect(refine.onDetection({ centerX: 0.7, centerY: 0.5, score: 0.9 })).toBeNull(); // not active yet
    refine.activate();
    expect(refine.onDetection({ centerX: 0.7, centerY: 0.5, score: 0.4 })).toBeNull(); // weak detection
    const c = refine.onDetection({ centerX: 0.7, centerY: 0.5, score: 0.9 });
    expect(c!.pan).toBeGreaterThan(0);
  });

  it('declares track loss once after the timeout and raises the fail-safe notification', () => {
    const h = setup({ lossTimeoutMs: 4000 });
    h.refine.activate(); // lastGood at t=1000
    h.refine.checkTrackLoss(); // still fresh
    expect(h.calls.raised).toHaveLength(0);
    h.setClock(6000); // > timeout since the last good detection
    h.refine.checkTrackLoss();
    h.refine.checkTrackLoss(); // a second check must not re-raise
    expect(h.calls.raised).toEqual([VISUAL_LOST_MESSAGE]);
    expect(h.refine.isLost()).toBe(true);
  });

  it('does not declare loss at exactly the timeout boundary (strict >)', () => {
    const h = setup({ lossTimeoutMs: 4000 });
    h.refine.activate(); // t=1000
    h.setClock(5000); // elapsed == lossTimeoutMs
    h.refine.checkTrackLoss();
    expect(h.refine.isLost()).toBe(false);
    h.setClock(5001); // one past the boundary
    h.refine.checkTrackLoss();
    expect(h.refine.isLost()).toBe(true);
  });

  it('recovers from a lost track on a new confident detection (clears the banner)', () => {
    const h = setup();
    h.refine.activate();
    h.setClock(6000);
    h.refine.checkTrackLoss();
    expect(h.refine.isLost()).toBe(true);
    const c = h.refine.onDetection({ centerX: 0.6, centerY: 0.5, score: 0.8 });
    expect(c).not.toBeNull();
    expect(h.refine.isLost()).toBe(false);
    expect(h.calls.cleared).toBe(1);
  });

  it('re-raises the fail-safe after a recover -> lose-again cycle (latch resets)', () => {
    const h = setup({ lossTimeoutMs: 4000 });
    h.refine.activate(); // t=1000
    h.setClock(6000);
    h.refine.checkTrackLoss(); // lost #1
    h.refine.onDetection({ centerX: 0.6, centerY: 0.5, score: 0.8 }); // recover at t=6000
    expect(h.refine.isLost()).toBe(false);
    h.setClock(11000); // > 4000 since recovery
    h.refine.checkTrackLoss(); // lost #2
    expect(h.refine.isLost()).toBe(true);
    expect(h.calls.raised).toEqual([VISUAL_LOST_MESSAGE, VISUAL_LOST_MESSAGE]);
  });

  it('re-activating while lost clears the orphaned banner and keeps the invariant', () => {
    const h = setup();
    h.refine.activate();
    h.setClock(6000);
    h.refine.checkTrackLoss(); // lost -> banner up
    expect(h.refine.isLost()).toBe(true);
    // A second MOB trigger (routine: POST /mob / the action call activate() again) must clear the
    // banner, not orphan it — otherwise nothing can ever clear it again.
    h.refine.activate();
    expect(h.calls.cleared).toBe(1);
    expect(h.refine.isLost()).toBe(false);
    // And a later deactivate must NOT double-clear (the banner is already down).
    h.refine.deactivate();
    expect(h.calls.cleared).toBe(1);
  });

  it('rate-limits the camera nudge so a burst of detections cannot accumulate drift', () => {
    const h = setup({ minCorrectionIntervalMs: 1000 });
    h.refine.activate(); // t=1000, lastCorrection = -inf
    const d = { centerX: 0.9, centerY: 0.5, score: 0.9 };
    // First confident detection corrects; a burst within the interval is throttled to null...
    expect(h.refine.onDetection(d)).not.toBeNull();
    expect(h.refine.onDetection(d)).toBeNull();
    h.setClock(1500); // still within the 1000ms window of the last correction (t=1000)
    expect(h.refine.onDetection(d)).toBeNull();
    // ...but the throttled detections still keep the track ALIVE (no false loss).
    h.refine.checkTrackLoss();
    expect(h.refine.isLost()).toBe(false);
    // Past the interval, the next detection corrects again.
    h.setClock(2200); // 1200ms since the last emitted correction at t=1000
    expect(h.refine.onDetection(d)).not.toBeNull();
  });

  it('deactivate clears an outstanding lost banner and stops correcting', () => {
    const h = setup();
    h.refine.activate();
    h.setClock(6000);
    h.refine.checkTrackLoss(); // lost -> banner up
    h.refine.deactivate();
    expect(h.calls.cleared).toBe(1);
    expect(h.refine.isActive()).toBe(false);
    expect(h.refine.onDetection({ centerX: 0.9, centerY: 0.5, score: 1 })).toBeNull();
  });

  it('a weak detection does not reset the loss timer', () => {
    const h = setup({ lossTimeoutMs: 4000 });
    h.refine.activate(); // t=1000
    h.setClock(3000);
    h.refine.onDetection({ centerX: 0.6, centerY: 0.5, score: 0.3 }); // weak, ignored
    h.setClock(6000);
    h.refine.checkTrackLoss();
    expect(h.refine.isLost()).toBe(true); // still timed out from t=1000
  });
});
