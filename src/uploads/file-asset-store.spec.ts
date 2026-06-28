import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  statSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAssetIndexPersistence, FileBlobStore, createFileAssetStore } from './file-asset-store';
import { AssetQuotaError, AssetRejectedError, type IVideoAsset } from './asset-store';

const streamOf = (bytes: Uint8Array) => Readable.from(Buffer.from(bytes)) as NodeJS.ReadableStream;
const stagingFiles = (dir: string): string[] =>
  existsSync(join(dir, 'videos'))
    ? readdirSync(join(dir, 'videos')).filter((f) => f.startsWith('.staging-'))
    : [];

/** A valid minimal mp4 header (ftyp + isom) padded to a chosen size. */
function mp4(size = 64): Uint8Array {
  const head = [0, 0, 0, 0x20];
  for (const ch of 'ftypisom') head.push(ch.charCodeAt(0));
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return bytes;
}

const dirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skv-test-'));
  dirs.push(dir);
  return dir;
}

const ownerOnly = process.platform !== 'win32';

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

function asset(id: string, over: Partial<IVideoAsset> = {}): IVideoAsset {
  return {
    id,
    name: `${id}.mp4`,
    contentType: 'video/mp4',
    size: 123,
    createdAt: 1000,
    ...over,
  };
}

describe('FileAssetIndexPersistence', () => {
  it('load() returns {} when the file is missing', () => {
    const dir = freshDir();
    expect(new FileAssetIndexPersistence(dir).load()).toEqual({});
  });

  it('load() returns {} for a corrupt, non-JSON file', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'videos.json'), 'this is not json {');
    expect(new FileAssetIndexPersistence(dir).load()).toEqual({});
  });

  it('load() returns {} for the JSON literal null', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'videos.json'), 'null');
    expect(new FileAssetIndexPersistence(dir).load()).toEqual({});
  });

  it('load() returns {} (a plain map, not an array) for an empty JSON array', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'videos.json'), '[]');
    const loaded = new FileAssetIndexPersistence(dir).load();
    // An array is not a valid id->metadata map; it must be rejected, not passed through.
    expect(Array.isArray(loaded)).toBe(false);
    expect(loaded).toEqual({});
  });

  it('load() returns {} (a plain map, not an array) for a populated JSON array', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'videos.json'), JSON.stringify([asset('a'), asset('b')]));
    const loaded = new FileAssetIndexPersistence(dir).load();
    expect(Array.isArray(loaded)).toBe(false);
    expect(loaded).toEqual({});
  });

  it('load() returns the parsed object for a valid JSON object', () => {
    const dir = freshDir();
    const index = { a: asset('a'), b: asset('b', { size: 9 }) };
    writeFileSync(join(dir, 'videos.json'), JSON.stringify(index));
    expect(new FileAssetIndexPersistence(dir).load()).toEqual(index);
  });

  it('save() creates the parent directory and writes <dataDir>/videos.json', () => {
    const dir = freshDir();
    const nested = join(dir, 'does', 'not', 'exist', 'yet');
    const file = join(nested, 'videos.json');
    expect(existsSync(nested)).toBe(false);

    new FileAssetIndexPersistence(nested).save({ a: asset('a') });

    expect(existsSync(file)).toBe(true);
  });

  it('save() honours a custom filename', () => {
    const dir = freshDir();
    new FileAssetIndexPersistence(dir, 'custom.json').save({ a: asset('a') });
    expect(existsSync(join(dir, 'custom.json'))).toBe(true);
    expect(existsSync(join(dir, 'videos.json'))).toBe(false);
  });

  it('save() writes pretty-printed JSON (two-space indent)', () => {
    const dir = freshDir();
    const index = { a: asset('a') };
    new FileAssetIndexPersistence(dir).save(index);

    const text = readFileSync(join(dir, 'videos.json'), 'utf8');
    expect(text).toBe(JSON.stringify(index, null, 2));
    expect(text).toContain('\n');
  });

  it('save() writes the index file with owner-only 0o600 perms', () => {
    const dir = freshDir();
    const file = join(dir, 'videos.json');
    new FileAssetIndexPersistence(dir).save({ a: asset('a') });
    if (ownerOnly) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('round-trips through a FRESH instance reading from disk', () => {
    const dir = freshDir();
    const index = { x: asset('x', { name: 'My Clip.mp4', size: 4096, createdAt: 42 }) };

    new FileAssetIndexPersistence(dir).save(index);
    // A brand-new instance proves the data was actually persisted to disk.
    const reloaded = new FileAssetIndexPersistence(dir).load();

    expect(reloaded).toEqual(index);
  });
});

describe('FileBlobStore', () => {
  it('write() creates the videos dir and stores the bytes', () => {
    const dir = freshDir();
    const store = new FileBlobStore(dir);
    expect(existsSync(join(dir, 'videos'))).toBe(false);

    store.write('id-1', mp4(32));

    expect(existsSync(join(dir, 'videos'))).toBe(true);
    expect(existsSync(join(dir, 'videos', 'id-1'))).toBe(true);
  });

  it('write() stores the blob with owner-only 0o600 perms', () => {
    const dir = freshDir();
    const store = new FileBlobStore(dir);
    store.write('id-1', mp4(32));
    if (ownerOnly) {
      expect(statSync(store.pathFor('id-1')).mode & 0o777).toBe(0o600);
    }
  });

  it('has() is false before write, true after, and false after remove', () => {
    const dir = freshDir();
    const store = new FileBlobStore(dir);
    expect(store.has('id-1')).toBe(false);
    store.write('id-1', mp4());
    expect(store.has('id-1')).toBe(true);
    store.remove('id-1');
    expect(store.has('id-1')).toBe(false);
  });

  it('remove() of a non-existent id does not throw', () => {
    const dir = freshDir();
    const store = new FileBlobStore(dir);
    expect(() => store.remove('never-existed')).not.toThrow();
    expect(store.has('never-existed')).toBe(false);
  });

  it('pathFor() returns join(dataDir, "videos", id)', () => {
    const dir = freshDir();
    const store = new FileBlobStore(dir);
    expect(store.pathFor('id-1')).toBe(join(dir, 'videos', 'id-1'));
  });

  it('pathFor() honours a custom subdir', () => {
    const dir = freshDir();
    const store = new FileBlobStore(dir, 'clips');
    expect(store.pathFor('id-1')).toBe(join(dir, 'clips', 'id-1'));
  });

  it('the written blob reads back equal to the original bytes', () => {
    const dir = freshDir();
    const store = new FileBlobStore(dir);
    const bytes = mp4(200);
    store.write('id-1', bytes);

    const onDisk = readFileSync(store.pathFor('id-1'));
    expect(Buffer.compare(onDisk, Buffer.from(bytes))).toBe(0);
    expect(onDisk.length).toBe(bytes.length);
  });
});

describe('createFileAssetStore', () => {
  it('persists the asset index across a fresh store instance', () => {
    const dir = freshDir();

    const store = createFileAssetStore(dir);
    const saved = store.add(mp4(128), 'My Clip.mp4');

    // A second store rooted at the same dir must rebuild itself purely from disk.
    const reopened = createFileAssetStore(dir);
    const listed = reopened.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(saved);
    expect(reopened.get(saved.id)?.id).toBe(saved.id);
    expect(reopened.usage()).toEqual({ totalBytes: 128, fileCount: 1 });
  });

  it('writes the blob to disk on add and removes it on delete', () => {
    const dir = freshDir();
    const store = createFileAssetStore(dir);

    const saved = store.add(mp4(96), 'clip.mp4');
    const blobPath = join(dir, 'videos', saved.id);
    expect(existsSync(blobPath)).toBe(true);
    expect(Buffer.compare(readFileSync(blobPath), Buffer.from(mp4(96)))).toBe(0);

    expect(store.delete(saved.id)).toBe(true);
    expect(existsSync(blobPath)).toBe(false);

    // The deletion is durable: a fresh store sees nothing.
    const reopened = createFileAssetStore(dir);
    expect(reopened.list()).toHaveLength(0);
    expect(reopened.get(saved.id)).toBeNull();
  });

  it('respects custom quota limits passed through', () => {
    const dir = freshDir();
    const store = createFileAssetStore(dir, {
      maxFileBytes: 50,
      maxTotalBytes: 1000,
      maxFileCount: 10,
    });
    expect(() => store.add(mp4(100), 'too-big.mp4')).toThrow();
    expect(existsSync(join(dir, 'videos'))).toBe(false);
  });

  describe('addFromStream (streamed upload)', () => {
    it('streams a valid upload to disk, commits it, and leaves no staging file', async () => {
      const dir = freshDir();
      const store = createFileAssetStore(dir);
      const saved = await store.addFromStream(streamOf(mp4(2048)), 'big clip.mp4');
      expect(saved.size).toBe(2048);
      expect(saved.contentType).toBe('video/mp4');
      expect(existsSync(join(dir, 'videos', saved.id))).toBe(true);
      expect(store.usage()).toEqual({ totalBytes: 2048, fileCount: 1 });
      expect(stagingFiles(dir)).toEqual([]); // the temp file was renamed into place, not left behind
    });

    it('caps an over-large stream and leaves no asset or staging file behind', async () => {
      const dir = freshDir();
      const store = createFileAssetStore(dir, {
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        maxFileCount: 10,
      });
      await expect(store.addFromStream(streamOf(mp4(5000)), 'too-big.mp4')).rejects.toBeInstanceOf(
        AssetQuotaError,
      );
      expect(store.list()).toHaveLength(0);
      expect(stagingFiles(dir)).toEqual([]);
    });

    it('rejects a non-video stream and discards the staged blob', async () => {
      const dir = freshDir();
      const store = createFileAssetStore(dir);
      await expect(
        store.addFromStream(streamOf(Buffer.from('<html>not a video</html>')), 'x.html'),
      ).rejects.toBeInstanceOf(AssetRejectedError);
      expect(store.list()).toHaveLength(0);
      expect(stagingFiles(dir)).toEqual([]);
    });
  });
});
