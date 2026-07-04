import { describe, it, expect } from 'vitest';
import { parseRoute, toHash } from './router';

describe('parseRoute', () => {
  it('parses a known cluster', () => {
    expect(parseRoute('#/live')).toEqual({ cluster: 'live', id: undefined });
    expect(parseRoute('#/library')).toEqual({ cluster: 'library', id: undefined });
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
    expect(parseRoute('#/nonsense/with/depth?q=1').cluster).toBe('live');
  });

  it('routes library tabs by id (#/library/recordings, #/library/incidents)', () => {
    expect(parseRoute('#/library/recordings')).toEqual({ cluster: 'library', id: 'recordings' });
    expect(parseRoute('#/library/incidents')).toEqual({ cluster: 'library', id: 'incidents' });
  });

  // The v1 deep-link contract: entity links are aliases that land on the right cluster/tab.
  it('aliases #/recordings/:id?t= to the review recordings tab (entity id and t dropped)', () => {
    expect(parseRoute('#/recordings/rec-42?t=1700000000000')).toEqual({
      cluster: 'library',
      id: 'recordings',
    });
    expect(parseRoute('#/recordings')).toEqual({ cluster: 'library', id: 'recordings' });
  });

  it('aliases #/incidents/:id to the review incidents tab (entity id dropped)', () => {
    expect(parseRoute('#/incidents/inc-7')).toEqual({ cluster: 'library', id: 'incidents' });
  });

  it('lands #/cameras/:id/calibrate on the Cameras cluster (action segment ignored)', () => {
    expect(parseRoute('#/cameras/bow/calibrate')).toEqual({ cluster: 'cameras', id: 'bow' });
  });
});

describe('toHash', () => {
  it('builds cluster and cluster/id hashes', () => {
    expect(toHash('library')).toBe('#/library');
    expect(toHash('live', 'bow cam')).toBe('#/live/bow%20cam');
  });
});
