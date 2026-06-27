import { describe, it, expect } from 'vitest';
import { bundlesToPrune, type IBundleSummary, type IBundleQuota } from './retention';

const b = (id: string, createdAt: number, totalBytes: number, pinned = false): IBundleSummary => ({
  id,
  createdAt,
  totalBytes,
  pinned,
});
const LIMITS: IBundleQuota = { maxBytes: 1000, maxCount: 10, maxAgeMs: 100_000 };

describe('bundlesToPrune', () => {
  it('returns [] when within every budget', () => {
    expect(bundlesToPrune([b('a', 1000, 100), b('b', 2000, 100)], LIMITS, 3000)).toEqual([]);
  });

  it('prunes by age, oldest first, but never a pinned bundle', () => {
    const out = bundlesToPrune(
      [b('old', 0, 100), b('old-pinned', 1, 100, true), b('new', 200_000, 100)],
      LIMITS,
      300_000, // both 'old' and 'old-pinned' exceed maxAgeMs from now
    );
    expect(out).toEqual(['old']); // pinned excluded; 'new' is within age
  });

  it('prunes oldest first to satisfy a byte budget, skipping pinned', () => {
    const out = bundlesToPrune(
      [b('a', 1, 600), b('b', 2, 600, true), b('c', 3, 600)],
      { maxBytes: 1000, maxCount: 10, maxAgeMs: 1_000_000 },
      10,
    );
    // total 1800 > 1000; 'a' (oldest non-pinned) pruned -> 1200 still > 1000; 'b' pinned skipped;
    // 'c' pruned -> 600 ok.
    expect(out.sort()).toEqual(['a', 'c']);
  });

  it('prunes oldest first to satisfy a count budget', () => {
    const out = bundlesToPrune(
      [b('a', 1, 10), b('b', 2, 10), b('c', 3, 10)],
      { maxBytes: 1_000_000, maxCount: 1, maxAgeMs: 1_000_000 },
      10,
    );
    expect(out.sort()).toEqual(['a', 'b']); // keep only the newest
  });
});
