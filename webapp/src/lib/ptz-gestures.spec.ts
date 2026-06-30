import { describe, it, expect } from 'vitest';
import {
  dragToVelocity,
  pinchToZoom,
  wheelToZoom,
  changedEnough,
  fingerDistance,
} from './ptz-gestures';

describe('dragToVelocity', () => {
  const R = 100;

  it('maps a full-radius drag to full velocity, matching the on-screen arrows', () => {
    // Right → pan right (+); up (negative dy) → tilt up (+).
    expect(dragToVelocity(R, 0, R)).toMatchObject({ pan: 1, tilt: 0 });
    expect(dragToVelocity(-R, 0, R)).toMatchObject({ pan: -1, tilt: 0 });
    expect(dragToVelocity(0, -R, R)).toMatchObject({ pan: 0, tilt: 1 });
    expect(dragToVelocity(0, R, R)).toMatchObject({ pan: 0, tilt: -1 });
  });

  it('clamps a drag past the radius to the [-1,1] range', () => {
    const v = dragToVelocity(3 * R, 0, R);
    expect(v.pan).toBe(1);
  });

  it('ignores tiny jitter inside the deadzone (the camera must not creep)', () => {
    expect(dragToVelocity(4, -3, R)).toEqual({ pan: 0, tilt: 0 });
  });

  it('ramps up past the deadzone (a half-radius drag is a gentle, non-zero speed)', () => {
    const v = dragToVelocity(R / 2, 0, R);
    expect(v.pan).toBeGreaterThan(0);
    expect(v.pan).toBeLessThan(0.6);
    expect(v.tilt).toBe(0);
  });

  it('treats a non-positive radius as safe (no divide-by-zero blow-up)', () => {
    const v = dragToVelocity(10, 10, 0);
    expect(Number.isFinite(v.pan)).toBe(true);
    expect(Number.isFinite(v.tilt)).toBe(true);
  });
});

describe('pinchToZoom', () => {
  it('spreading fingers zooms in (+), pinching zooms out (-)', () => {
    expect(pinchToZoom(100, 200)).toBeGreaterThan(0.5);
    expect(pinchToZoom(100, 50)).toBeLessThan(-0.5);
  });

  it('clamps to [-1,1]', () => {
    expect(pinchToZoom(100, 1000)).toBe(1);
    expect(pinchToZoom(100, 1)).toBe(-1);
  });

  it('has a deadzone for a near-still pinch', () => {
    expect(pinchToZoom(100, 101)).toBe(0);
  });

  it('is safe when the starting distance is zero', () => {
    expect(pinchToZoom(0, 100)).toBe(0);
  });
});

describe('wheelToZoom', () => {
  it('scroll up / pinch-out (deltaY<0) zooms in; down zooms out', () => {
    expect(wheelToZoom(-120)).toBeGreaterThan(0);
    expect(wheelToZoom(120)).toBeLessThan(0);
  });
  it('a zero delta is no zoom', () => {
    expect(wheelToZoom(0)).toBe(0);
  });
});

describe('changedEnough', () => {
  it('is true only when an axis moves past the epsilon', () => {
    expect(changedEnough({ pan: 0, tilt: 0, zoom: 0 }, { pan: 0.5, tilt: 0, zoom: 0 })).toBe(true);
    expect(changedEnough({ pan: 0.5, tilt: 0, zoom: 0 }, { pan: 0.51, tilt: 0, zoom: 0 })).toBe(
      false,
    );
  });
});

describe('fingerDistance', () => {
  it('is the euclidean distance between two points', () => {
    expect(fingerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
