import { describe, it, expect } from 'vitest';
import { parseRoute, toHash } from './router';

describe('parseRoute', () => {
  it('parses a known cluster', () => {
    expect(parseRoute('#/live')).toEqual({ cluster: 'live', id: undefined });
    expect(parseRoute('#/review')).toEqual({ cluster: 'review', id: undefined });
  });
  it('parses a focused camera id', () => {
    expect(parseRoute('#/live/foredeck')).toEqual({ cluster: 'live', id: 'foredeck' });
    expect(parseRoute('#/cameras/bow%20cam')).toEqual({ cluster: 'cameras', id: 'bow cam' });
  });
  it('drops a query and tolerates a bad encoding', () => {
    expect(parseRoute('#/live/foredeck?t=1').id).toBe('foredeck');
    expect(parseRoute('#/live/%E0%A4%A').id).toBeUndefined();
  });
  it('falls back to live for empty or unknown clusters', () => {
    expect(parseRoute('').cluster).toBe('live');
    expect(parseRoute('#/nonsense').cluster).toBe('live');
  });
});

describe('toHash', () => {
  it('builds cluster and cluster/id hashes', () => {
    expect(toHash('review')).toBe('#/review');
    expect(toHash('live', 'bow cam')).toBe('#/live/bow%20cam');
  });
});
