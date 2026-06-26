import { describe, it, expect } from 'vitest';
import {
  AssetStore,
  AssetQuotaError,
  AssetRejectedError,
  sanitizeFilename,
  type IAssetIndexPersistence,
  type IBlobStore,
  type IVideoAsset,
} from './asset-store';

/** A valid minimal mp4 header (ftyp + isom) padded to a chosen size. */
function mp4(size = 64): Uint8Array {
  const head = [0, 0, 0, 0x20];
  for (const ch of 'ftypisom') head.push(ch.charCodeAt(0));
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return bytes;
}

function fakes() {
  const blobs = new Map<string, Uint8Array>();
  let saved: Record<string, IVideoAsset> = {};
  const index: IAssetIndexPersistence = {
    load: () => saved,
    save: (i) => {
      saved = i;
    },
  };
  const blobStore: IBlobStore = {
    write: (id, bytes) => blobs.set(id, bytes),
    remove: (id) => void blobs.delete(id),
    has: (id) => blobs.has(id),
    pathFor: (id) => `/data/videos/${id}`,
  };
  return { blobs, index, blobStore, getSaved: () => saved };
}

function counterIds() {
  let n = 0;
  return () => `id-${++n}`;
}

describe('sanitizeFilename', () => {
  it('strips directories, control chars and unsafe characters', () => {
    expect(sanitizeFilename('../../etc/pass\x00wd<>.mp4')).toBe('passwd__.mp4');
  });
  it('returns empty for nothing', () => {
    expect(sanitizeFilename(undefined)).toBe('');
  });
});

describe('AssetStore', () => {
  it('stores a valid mp4 and records derived metadata, not client claims', () => {
    const f = fakes();
    const store = new AssetStore({
      index: f.index,
      blobs: f.blobStore,
      idGen: counterIds(),
      now: () => 1000,
    });
    const asset = store.add(mp4(100), 'My Clip.mp4');
    expect(asset).toEqual({
      id: 'id-1',
      name: 'My Clip.mp4',
      contentType: 'video/mp4',
      size: 100,
      createdAt: 1000,
    });
    expect(f.blobs.get('id-1')).toBeInstanceOf(Uint8Array);
    expect(f.getSaved()['id-1']).toEqual(asset); // persisted to the index
  });

  it('rejects a non-video payload by magic bytes', () => {
    const f = fakes();
    const s = new AssetStore({
      index: f.index,
      blobs: f.blobStore,
      idGen: counterIds(),
    });
    const html = Uint8Array.from('<!DOCTYPE html>'.split('').map((c) => c.charCodeAt(0)));
    expect(() => s.add(html, 'evil.mp4')).toThrow(AssetRejectedError);
    expect(f.blobs.size).toBe(0); // nothing written
  });

  it('enforces the per-file size cap', () => {
    const f = fakes();
    const store = new AssetStore({
      index: f.index,
      blobs: f.blobStore,
      idGen: counterIds(),
      limits: { maxFileBytes: 50, maxTotalBytes: 1000, maxFileCount: 10 },
    });
    expect(() => store.add(mp4(100), 'big.mp4')).toThrow(AssetQuotaError);
  });

  it('enforces the total budget and file-count caps across uploads', () => {
    const f = fakes();
    const store = new AssetStore({
      index: f.index,
      blobs: f.blobStore,
      idGen: counterIds(),
      limits: { maxFileBytes: 1000, maxTotalBytes: 150, maxFileCount: 10 },
    });
    store.add(mp4(100), 'a.mp4');
    expect(() => store.add(mp4(100), 'b.mp4')).toThrow(AssetQuotaError); // 200 > 150 budget
    expect(store.usage()).toEqual({ totalBytes: 100, fileCount: 1 });
  });

  it('lists, gets and deletes assets, cleaning up the blob', () => {
    const f = fakes();
    const store = new AssetStore({
      index: f.index,
      blobs: f.blobStore,
      idGen: counterIds(),
    });
    const a = store.add(mp4(), 'a.mp4');
    expect(store.list()).toHaveLength(1);
    expect(store.get(a.id)?.id).toBe(a.id);
    expect(store.delete(a.id)).toBe(true);
    expect(store.get(a.id)).toBeNull();
    expect(f.blobs.has(a.id)).toBe(false);
    expect(store.delete(a.id)).toBe(false); // already gone
  });

  it('reloads existing assets from the index on construction', () => {
    const f = fakes();
    new AssetStore({
      index: f.index,
      blobs: f.blobStore,
      idGen: counterIds(),
    }).add(mp4(), 'a.mp4');
    const reopened = new AssetStore({ index: f.index, blobs: f.blobStore });
    expect(reopened.list()).toHaveLength(1);
  });
});
