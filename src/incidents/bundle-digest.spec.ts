import { describe, it, expect } from 'vitest';
import { hashBytes, computeBundleDigest } from './bundle-digest';

describe('hashBytes', () => {
  it('matches the known SHA-256 of "abc"', () => {
    expect(hashBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('computeBundleDigest', () => {
  const core = {
    id: 'inc-1',
    createdAt: 1000,
    assets: [
      { id: 'b', sha256: 'bb', size: 2 },
      { id: 'a', sha256: 'aa', size: 1 },
    ],
  };

  it('is stable and order-independent over the assets', () => {
    const reordered = { ...core, assets: [core.assets[1], core.assets[0]] };
    expect(computeBundleDigest(core)).toBe(computeBundleDigest(reordered));
  });

  it('changes when any asset hash or size changes', () => {
    const base = computeBundleDigest(core);
    expect(
      computeBundleDigest({
        ...core,
        assets: [
          { id: 'a', sha256: 'aa', size: 1 },
          { id: 'b', sha256: 'XX', size: 2 },
        ],
      }),
    ).not.toBe(base);
    expect(computeBundleDigest({ ...core, createdAt: 1001 })).not.toBe(base);
  });
});
