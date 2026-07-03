import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DENSITIES, DENSITY_LABELS, isDensity, loadDensity, applyDensity } from './density';

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

/** jsdom's matchMedia never matches, so device tests stub it per media feature. */
function stubMatchMedia(matches: Record<string, boolean>) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({ matches: matches[query] ?? false }) as MediaQueryList,
  );
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-density');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('density', () => {
  it('validates the known densities', () => {
    expect(DENSITIES).toEqual(['helm', 'desk']);
    expect(isDensity('desk')).toBe(true);
    expect(isDensity('cozy')).toBe(false);
    expect(DENSITY_LABELS.helm).toBe('Helm');
  });

  it('loads a stored density over the device default', () => {
    expect(loadDensity(fakeStorage('desk'))).toBe('desk');
    expect(loadDensity(fakeStorage('helm'))).toBe('helm');
  });

  it('falls back to a device default when nothing is stored (Helm without a wide-screen match)', () => {
    // jsdom's matchMedia never matches → the safe fallback is the roomy Helm-glance.
    expect(loadDensity(fakeStorage(undefined))).toBe('helm');
    expect(loadDensity(fakeStorage('bogus'))).toBe('helm');
  });

  it('defaults a fine-pointer wide screen (chart-table desktop) to Desk', () => {
    stubMatchMedia({ '(pointer: coarse)': false, '(min-width: 1024px)': true });
    expect(loadDensity(fakeStorage(undefined))).toBe('desk');
  });

  it('defaults a coarse-pointer device to Helm even when the screen is wide (big helm tablet)', () => {
    stubMatchMedia({ '(pointer: coarse)': true, '(min-width: 1024px)': true });
    expect(loadDensity(fakeStorage(undefined))).toBe('helm');
  });

  it('defaults a fine-pointer narrow screen to Helm', () => {
    stubMatchMedia({ '(pointer: coarse)': false, '(min-width: 1024px)': false });
    expect(loadDensity(fakeStorage(undefined))).toBe('helm');
  });

  it('lets the persisted choice win over any device default', () => {
    stubMatchMedia({ '(pointer: coarse)': true, '(min-width: 1024px)': true });
    expect(loadDensity(fakeStorage('desk'))).toBe('desk');
  });

  it('survives a matchMedia that throws (falls back to Helm)', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('nope');
    });
    expect(loadDensity(fakeStorage(undefined))).toBe('helm');
  });

  it('applies the density to the document root and persists it', () => {
    const storage = fakeStorage();
    applyDensity('desk', { storage });
    expect(document.documentElement.getAttribute('data-density')).toBe('desk');
    expect(storage.read()).toBe('desk');
  });
});
