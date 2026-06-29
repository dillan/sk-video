import { describe, it, expect } from 'vitest';
import { routeFromHash } from './router';

describe('routeFromHash', () => {
  it('parses a known route from the hash', () => {
    expect(routeFromHash('#/live')).toBe('live');
    expect(routeFromHash('#/review')).toBe('review');
    expect(routeFromHash('#/cameras')).toBe('cameras');
    expect(routeFromHash('#/safety')).toBe('safety');
  });
  it('ignores trailing segments and query', () => {
    expect(routeFromHash('#/cameras/bow')).toBe('cameras');
    expect(routeFromHash('#/review?t=123')).toBe('review');
  });
  it('falls back to live for empty or unknown hashes', () => {
    expect(routeFromHash('')).toBe('live');
    expect(routeFromHash('#/')).toBe('live');
    expect(routeFromHash('#/nonsense')).toBe('live');
  });
});
