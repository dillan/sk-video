import { describe, it, expect } from 'vitest';
import { ScanThrottle } from './scan-throttle';

describe('ScanThrottle', () => {
  function clock(start = 1000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it('allows the first scan', () => {
    const t = new ScanThrottle(5000, clock().now);
    expect(t.canScan()).toBe(true);
    expect(() => t.begin()).not.toThrow();
  });

  it('blocks a second scan while one is in flight', () => {
    const t = new ScanThrottle(5000, clock().now);
    t.begin();
    expect(t.canScan()).toBe(false);
    expect(() => t.begin()).toThrow();
  });

  it('enforces the cooldown after a scan ends', () => {
    const c = clock();
    const t = new ScanThrottle(5000, c.now);
    t.begin();
    t.end();
    expect(t.canScan()).toBe(false);
    expect(t.retryAfterMs()).toBe(5000);

    c.advance(4999);
    expect(t.canScan()).toBe(false);
    expect(t.retryAfterMs()).toBe(1);

    c.advance(1);
    expect(t.canScan()).toBe(true);
    expect(t.retryAfterMs()).toBe(0);
  });

  it('reports no retry delay before any scan has run', () => {
    const t = new ScanThrottle(5000, clock().now);
    expect(t.retryAfterMs()).toBe(0);
  });

  it('throws from begin() during the cooldown window after a scan completes', () => {
    const c = clock();
    const t = new ScanThrottle(5000, c.now);
    t.begin();
    t.end();

    c.advance(2000);
    expect(t.canScan()).toBe(false);
    expect(() => t.begin()).toThrow('discovery is cooling down; retry in 3000ms');
  });

  it('stops throwing from begin() once the cooldown has fully elapsed', () => {
    const c = clock();
    const t = new ScanThrottle(5000, c.now);
    t.begin();
    t.end();

    c.advance(4999);
    expect(() => t.begin()).toThrow('discovery is cooling down; retry in 1ms');

    c.advance(1);
    expect(() => t.begin()).not.toThrow();
  });
});
