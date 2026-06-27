import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('allows up to max requests per window, then blocks with a retry-after', () => {
    const now = 1000;
    const rl = new RateLimiter({ max: 2, windowMs: 1000, now: () => now });
    expect(rl.check('ip1').ok).toBe(true);
    expect(rl.check('ip1').ok).toBe(true);
    const blocked = rl.check('ip1');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('slides the window so requests succeed again after it passes', () => {
    let now = 0;
    const rl = new RateLimiter({ max: 1, windowMs: 1000, now: () => now });
    expect(rl.check('ip1').ok).toBe(true);
    expect(rl.check('ip1').ok).toBe(false);
    now = 1001;
    expect(rl.check('ip1').ok).toBe(true);
  });

  it('uses the real clock by default', () => {
    const rl = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.check('x').ok).toBe(true);
    expect(rl.check('x').ok).toBe(false);
  });

  it('tracks keys independently', () => {
    const now = 0;
    const rl = new RateLimiter({ max: 1, windowMs: 1000, now: () => now });
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('b').ok).toBe(true);
    expect(rl.check('a').ok).toBe(false);
  });
});
