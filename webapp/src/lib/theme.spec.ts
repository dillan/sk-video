import { describe, it, expect, beforeEach } from 'vitest';
import { THEMES, THEME_LABELS, isTheme, loadTheme, applyTheme } from './theme';

/** A minimal in-memory Storage stand-in (the parts the theme lib uses). */
function fakeStorage(initial?: string) {
  let v = initial;
  return {
    getItem: () => v ?? null,
    setItem: (_k: string, value: string) => {
      v = value;
    },
    read: () => v,
  };
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('validates the known themes', () => {
    expect(THEMES).toEqual(['dark', 'night']);
    expect(isTheme('night')).toBe(true);
    expect(isTheme('day')).toBe(false); // deferred — a light-canvas pass, not a token swap
    expect(isTheme('sepia')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(THEME_LABELS.night).toBe('Night-Red');
  });

  it('loads a stored theme, falling back to Dark for missing or invalid values', () => {
    expect(loadTheme(fakeStorage('night'))).toBe('night');
    expect(loadTheme(fakeStorage(undefined))).toBe('dark');
    expect(loadTheme(fakeStorage('bogus'))).toBe('dark');
  });

  it('falls back to Dark when storage throws (e.g. privacy mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadTheme(throwing)).toBe('dark');
  });

  it('applies the theme to the document root and persists it', () => {
    const storage = fakeStorage();
    applyTheme('night', { storage });
    expect(document.documentElement.getAttribute('data-theme')).toBe('night');
    expect(storage.read()).toBe('night');
  });

  it('still applies the attribute when persistence throws', () => {
    const throwing = {
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => applyTheme('night', { storage: throwing })).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('night');
  });
});
