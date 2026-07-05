import { describe, it, expect } from 'vitest';
import { loadViewMode, saveViewMode, isViewMode } from './view-mode';

function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('view-mode preference', () => {
  it('defaults to grid when nothing is stored', () => {
    expect(loadViewMode('videos', memStorage())).toBe('grid');
  });

  it('round-trips a per-view choice under a namespaced key', () => {
    const store = memStorage();
    saveViewMode('videos', 'list', store);
    expect(store.getItem('sk-video.view.videos')).toBe('list');
    expect(loadViewMode('videos', store)).toBe('list');
  });

  it('keeps each view independent', () => {
    const store = memStorage();
    saveViewMode('videos', 'list', store);
    saveViewMode('incidents', 'grid', store);
    expect(loadViewMode('videos', store)).toBe('list');
    expect(loadViewMode('incidents', store)).toBe('grid');
  });

  it('ignores a garbage stored value and falls back to grid', () => {
    expect(loadViewMode('videos', memStorage({ 'sk-video.view.videos': 'mosaic' }))).toBe('grid');
  });

  it('never throws when storage is unavailable (privacy mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadViewMode('videos', throwing)).toBe('grid');
    expect(() => saveViewMode('videos', 'list', throwing)).not.toThrow();
  });

  it('validates the mode type guard', () => {
    expect(isViewMode('grid')).toBe(true);
    expect(isViewMode('list')).toBe(true);
    expect(isViewMode('tiles')).toBe(false);
    expect(isViewMode(null)).toBe(false);
  });
});
