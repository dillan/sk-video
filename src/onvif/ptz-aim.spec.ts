import { describe, it, expect } from 'vitest';
import { planAim, DEFAULT_AIM_GAIN, DEFAULT_AIM_MAX_STEP } from './ptz-aim';

const pos = (pan: number, tilt: number, zoom = 0.3) => ({ pan, tilt, zoom });

describe('planAim', () => {
  it('aims with an absolute move from the current position when the camera has absolute PTZ', () => {
    const plan = planAim({ absolutePtz: true }, pos(0, 0), { dx: 0.25, dy: -0.1 });
    expect(plan.kind).toBe('absolute');
    if (plan.kind !== 'absolute') throw new Error('unreachable');
    // +dx pans right; +tilt is up, so a point ABOVE centre (dy < 0) tilts up (−dy·gain > 0).
    expect(plan.position.pan).toBeCloseTo(0.25 * DEFAULT_AIM_GAIN, 5);
    expect(plan.position.tilt).toBeCloseTo(0.1 * DEFAULT_AIM_GAIN, 5);
    expect(plan.position.zoom).toBe(0.3); // zoom preserved
    expect(plan.outcome).toBe('aimed');
  });

  it('reports at-limit when the target clamps past the mechanical range', () => {
    const plan = planAim({ absolutePtz: true }, pos(0.9, 0), { dx: 0.5, dy: 0 });
    expect(plan.kind).toBe('absolute');
    if (plan.kind !== 'absolute') throw new Error('unreachable');
    expect(plan.position.pan).toBe(1); // 0.9 + 0.4 → clamped to 1
    expect(plan.outcome).toBe('at-limit');
  });

  it('falls back to a bounded relative nudge when the camera lacks absolute PTZ', () => {
    const plan = planAim({ absolutePtz: false }, null, { dx: 0.3, dy: 0.2 });
    expect(plan.kind).toBe('relative');
    if (plan.kind !== 'relative') throw new Error('unreachable');
    expect(plan.delta.pan).toBeCloseTo(0.3 * DEFAULT_AIM_GAIN, 5);
    // A point BELOW centre (dy > 0) tilts down (−dy·gain < 0).
    expect(plan.delta.tilt).toBeCloseTo(-0.2 * DEFAULT_AIM_GAIN, 5);
    expect(plan.delta.zoom).toBe(0);
    expect(plan.outcome).toBe('aimed');
  });

  it('bounds each axis to maxStep so a stray/edge tap cannot slew far', () => {
    const plan = planAim({ absolutePtz: false }, null, { dx: 5, dy: -5 }); // absurd offset
    expect(plan.kind).toBe('relative');
    if (plan.kind !== 'relative') throw new Error('unreachable');
    expect(plan.delta.pan).toBe(DEFAULT_AIM_MAX_STEP);
    expect(plan.delta.tilt).toBe(DEFAULT_AIM_MAX_STEP);
  });

  it('uses a relative nudge when absolutePtz is claimed but no current position is known', () => {
    const plan = planAim({ absolutePtz: true }, null, { dx: 0.1, dy: 0 });
    expect(plan.kind).toBe('relative'); // cannot compute an absolute target without the current position
  });

  it('coerces a non-finite offset to no movement', () => {
    const plan = planAim({ absolutePtz: false }, null, { dx: NaN, dy: Infinity });
    expect(plan.kind).toBe('relative');
    if (plan.kind !== 'relative') throw new Error('unreachable');
    expect(plan.delta.pan).toBe(0);
    expect(plan.delta.tilt).toBe(0);
  });
});
