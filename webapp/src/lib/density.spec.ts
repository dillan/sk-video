import { describe, it, expect, beforeEach } from 'vitest';
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

beforeEach(() => {
  document.documentElement.removeAttribute('data-density');
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
    // jsdom has no matchMedia by default → the safe fallback is the roomy Helm-glance.
    expect(loadDensity(fakeStorage(undefined))).toBe('helm');
    expect(loadDensity(fakeStorage('bogus'))).toBe('helm');
  });

  it('applies the density to the document root and persists it', () => {
    const storage = fakeStorage();
    applyDensity('desk', { storage });
    expect(document.documentElement.getAttribute('data-density')).toBe('desk');
    expect(storage.read()).toBe('desk');
  });
});
