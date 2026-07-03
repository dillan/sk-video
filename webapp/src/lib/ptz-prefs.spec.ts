import { describe, it, expect } from 'vitest';
import { loadContinuousPtz, saveContinuousPtz, allowPadEvent } from './ptz-prefs';

const mem = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
};

describe('continuous-PTZ preference', () => {
  it('defaults OFF (discrete nudges are the safe default) and round-trips', () => {
    const storage = mem();
    expect(loadContinuousPtz(storage)).toBe(false);
    saveContinuousPtz(true, storage);
    expect(loadContinuousPtz(storage)).toBe(true);
    saveContinuousPtz(false, storage);
    expect(loadContinuousPtz(storage)).toBe(false);
  });

  it('survives a throwing storage (privacy mode) as OFF', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadContinuousPtz(throwing)).toBe(false);
    expect(() => saveContinuousPtz(true, throwing)).not.toThrow();
  });
});

describe('allowPadEvent', () => {
  it('always passes discrete steps and the safety stop', () => {
    for (const opts of [
      { continuous: false, delayed: false },
      { continuous: false, delayed: true },
      { continuous: true, delayed: true },
    ]) {
      expect(allowPadEvent('step', opts)).toBe(true);
      expect(allowPadEvent('panend', opts)).toBe(true);
    }
  });

  it('passes continuous pan only when opted in AND the feed is live', () => {
    expect(allowPadEvent('pan', { continuous: true, delayed: false })).toBe(true);
    expect(allowPadEvent('pan', { continuous: false, delayed: false })).toBe(false);
    expect(allowPadEvent('pan', { continuous: true, delayed: true })).toBe(false);
  });
});
