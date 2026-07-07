import { describe, it, expect } from 'vitest';
import { tapOffset } from './tap-aim';

const rect = (over: Partial<DOMRect> = {}): DOMRect =>
  ({ left: 100, top: 50, width: 400, height: 200, ...over }) as DOMRect;

describe('tapOffset', () => {
  it('maps a centre tap to zero offset', () => {
    // centre of the rect: x = 100 + 200, y = 50 + 100
    expect(tapOffset(rect(), 300, 150)).toEqual({ nx: 0.5, ny: 0.5, dx: 0, dy: 0 });
  });

  it('maps a tap right-and-down of centre to +dx / +dy', () => {
    const r = tapOffset(rect(), 400, 200)!; // 3/4 across, 3/4 down
    expect(r.nx).toBeCloseTo(0.75, 5);
    expect(r.ny).toBeCloseTo(0.75, 5);
    expect(r.dx).toBeCloseTo(0.25, 5); // right of centre
    expect(r.dy).toBeCloseTo(0.25, 5); // below centre
  });

  it('maps a tap left-and-up of centre to −dx / −dy', () => {
    const r = tapOffset(rect(), 200, 100)!; // 1/4 across, 1/4 down
    expect(r.dx).toBeCloseTo(-0.25, 5);
    expect(r.dy).toBeCloseTo(-0.25, 5);
  });

  it('returns null for a zero-size rect (nothing to aim at)', () => {
    expect(tapOffset(rect({ width: 0 }), 300, 150)).toBeNull();
    expect(tapOffset(rect({ height: 0 }), 300, 150)).toBeNull();
  });
});
