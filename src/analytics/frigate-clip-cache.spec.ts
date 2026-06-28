import { describe, it, expect } from 'vitest';
import { cacheFrigateClip } from './frigate-clip-cache';
import {
  AssetStore,
  type IAssetIndexPersistence,
  type IBlobStore,
  type IVideoAsset,
} from '../uploads/asset-store';

/** A minimal valid MP4 (ftyp box) so the store's magic-byte check passes. */
function mp4(size = 64): Uint8Array {
  const head = [0, 0, 0, 0x20, ...'ftypisom'.split('').map((c) => c.charCodeAt(0))];
  const b = new Uint8Array(Math.max(size, head.length));
  b.set(head);
  return b;
}

function makeStore(limits?: ConstructorParameters<typeof AssetStore>[0]['limits']) {
  let saved: Record<string, IVideoAsset> = {};
  const blobStore: Record<string, Uint8Array> = {};
  const index: IAssetIndexPersistence = { load: () => saved, save: (i) => (saved = i) };
  const blobs: IBlobStore = {
    write: (id, bytes) => (blobStore[id] = bytes),
    remove: (id) => delete blobStore[id],
    has: (id) => id in blobStore,
    pathFor: (id) => `/clips/${id}`,
  };
  let n = 0;
  let t = 0;
  return new AssetStore({ index, blobs, limits, idGen: () => `c${++n}`, now: () => ++t });
}

describe('cacheFrigateClip', () => {
  it('stores a valid clip and returns its id', () => {
    const store = makeStore();
    const id = cacheFrigateClip(store, mp4(), 'evt.mp4');
    expect(id).toBe('c1');
    expect(store.list()).toHaveLength(1);
  });

  it('evicts the oldest clip when the count quota is hit (rolling buffer)', () => {
    const store = makeStore({ maxFileBytes: 1024, maxTotalBytes: 1024 * 1024, maxFileCount: 2 });
    const a = cacheFrigateClip(store, mp4(), 'a.mp4');
    const b = cacheFrigateClip(store, mp4(), 'b.mp4');
    const c = cacheFrigateClip(store, mp4(), 'c.mp4'); // over count cap -> evicts the oldest (a)
    expect(c).not.toBeNull();
    const ids = store.list().map((x) => x.id);
    expect(ids).not.toContain(a); // oldest evicted
    expect(ids).toContain(b);
    expect(ids).toContain(c);
    expect(store.list()).toHaveLength(2);
  });

  it('evicts oldest-first until a byte quota is satisfied', () => {
    const store = makeStore({ maxFileBytes: 100, maxTotalBytes: 150, maxFileCount: 100 });
    cacheFrigateClip(store, mp4(64), 'a.mp4'); // 64
    const c = cacheFrigateClip(store, mp4(64), 'b.mp4'); // 128 > 150? no -> ok (both fit, 128<=150)
    expect(c).not.toBeNull();
    const c2 = cacheFrigateClip(store, mp4(64), 'c.mp4'); // 192 > 150 -> evict oldest until it fits
    expect(c2).not.toBeNull();
    expect(store.usage().totalBytes).toBeLessThanOrEqual(150);
  });

  it('does not cache (or evict) a non-MP4 body', () => {
    const store = makeStore();
    cacheFrigateClip(store, mp4(), 'good.mp4');
    const bad = cacheFrigateClip(store, new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]), 'bad'); // "<html"
    expect(bad).toBeNull();
    expect(store.list()).toHaveLength(1); // the good clip is untouched
  });
});
