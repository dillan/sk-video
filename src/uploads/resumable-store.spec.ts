import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ResumableUploadStore, ResumableUploadError } from './resumable-store';
import {
  AssetStore,
  AssetQuotaError,
  type IAssetIndexPersistence,
  type IBlobStore,
} from './asset-store';

/** A valid minimal mp4 header (ftyp + isom) padded to a chosen size. */
function mp4(size = 64): Uint8Array {
  const head = [0, 0, 0, 0x20];
  for (const ch of 'ftypisom') head.push(ch.charCodeAt(0));
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return bytes;
}

const stream = (bytes: Uint8Array): Readable => Readable.from(Buffer.from(bytes));

/** An in-memory AssetStore good enough to prove finalize goes through sniff+quota+commit. */
function memoryAssetStore(limits?: { maxTotalBytes?: number }) {
  const blobs = new Map<string, Uint8Array>();
  let saved = {} as ReturnType<IAssetIndexPersistence['load']>;
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
    pathFor: (id) => `/mem/${id}`,
    async stageFromStream(s, maxBytes) {
      const chunks: Buffer[] = [];
      for await (const chunk of s) chunks.push(Buffer.from(chunk as Buffer));
      const all = new Uint8Array(Buffer.concat(chunks));
      if (all.length > maxBytes)
        return { ref: 'x', size: all.length, head: all, outcome: 'too-large' };
      return { ref: 'staged', size: all.length, head: all.slice(0, 16), outcome: 'ok' };
    },
    commitStaged(staged, id) {
      blobs.set(id, new Uint8Array()); // content immaterial to these tests
      void staged;
    },
    discardStaged() {},
  };
  let n = 0;
  return new AssetStore({
    index,
    blobs: blobStore,
    idGen: () => `a-${++n}`,
    now: () => 42,
    ...(limits
      ? {
          limits: {
            maxFileBytes: 2 ** 31,
            maxTotalBytes: limits.maxTotalBytes ?? 2 ** 33,
            maxFileCount: 100,
          },
        }
      : {}),
  });
}

function harness(
  opts: {
    now?: () => number;
    maxAgeMs?: number;
    maxSessions?: number;
    maxAggregateBytes?: number;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'sk-video-resumable-'));
  const store = new ResumableUploadStore(dir, opts);
  return { dir, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('ResumableUploadStore', () => {
  it('creates a session, appends in order, and tracks the offset', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      expect(up.offset).toBe(0);
      expect(up.size).toBe(100);

      const first = mp4(60).slice(0, 60);
      expect(await h.store.append(up.id, 0, stream(first))).toBe(60);
      expect(h.store.get(up.id)?.offset).toBe(60);

      const rest = mp4(100).slice(60);
      expect(await h.store.append(up.id, 60, stream(rest))).toBe(100);
      expect(h.store.get(up.id)?.offset).toBe(100);
    } finally {
      h.cleanup();
    }
  });

  it('rejects an append at the wrong offset with the CURRENT offset (the resume probe)', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      await h.store.append(up.id, 0, stream(mp4(100).slice(0, 40)));
      const err = await h.store.append(up.id, 10, stream(mp4(10))).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ResumableUploadError);
      expect((err as ResumableUploadError).code).toBe('offset-mismatch');
      expect(h.store.get(up.id)?.offset).toBe(40); // the partial is intact
    } finally {
      h.cleanup();
    }
  });

  it('rejects bytes beyond the declared size (a lying client cannot fill the disk)', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 50);
      const err = await h.store.append(up.id, 0, stream(mp4(80))).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ResumableUploadError);
      expect((err as ResumableUploadError).code).toBe('overflow');
      expect(h.store.get(up.id)).toBeNull(); // an overflowing session is discarded outright
    } finally {
      h.cleanup();
    }
  });

  it('completes through the asset store (sniff + quota + commit) and removes the partial', async () => {
    const h = harness();
    try {
      const assets = memoryAssetStore();
      const bytes = mp4(100);
      const up = h.store.create('clip.mp4', 100);
      await h.store.append(up.id, 0, stream(bytes.slice(0, 64)));
      await h.store.append(up.id, 64, stream(bytes.slice(64)));
      const asset = await h.store.complete(up.id, assets);
      expect(asset.name).toBe('clip.mp4');
      expect(asset.contentType).toBe('video/mp4');
      expect(h.store.get(up.id)).toBeNull(); // partial cleaned up after commit
    } finally {
      h.cleanup();
    }
  });

  it('refuses to complete an unfinished upload', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      await h.store.append(up.id, 0, stream(mp4(100).slice(0, 40)));
      const err = await h.store.complete(up.id, memoryAssetStore()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ResumableUploadError);
      expect((err as ResumableUploadError).code).toBe('incomplete');
      expect(h.store.get(up.id)?.offset).toBe(40); // still resumable
    } finally {
      h.cleanup();
    }
  });

  it('discards the partial when finalize rejects it (e.g. not a video)', async () => {
    const h = harness();
    try {
      const junk = new Uint8Array(100).fill(7); // no video magic bytes
      const up = h.store.create('junk.bin', 100);
      await h.store.append(up.id, 0, stream(junk));
      await expect(h.store.complete(up.id, memoryAssetStore())).rejects.toThrow();
      expect(h.store.get(up.id)).toBeNull(); // retrying the same bytes cannot help
    } finally {
      h.cleanup();
    }
  });

  it('survives a restart: a new store over the same dir resumes the same session', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      await h.store.append(up.id, 0, stream(mp4(100).slice(0, 64)));

      const reopened = new ResumableUploadStore(h.dir);
      expect(reopened.get(up.id)).toMatchObject({ name: 'clip.mp4', size: 100, offset: 64 });
      await reopened.append(up.id, 64, stream(mp4(100).slice(64)));
      expect(reopened.get(up.id)?.offset).toBe(100);
    } finally {
      h.cleanup();
    }
  });

  it('sweeps sessions idle past the max age, and discard() removes one on demand', async () => {
    let now = 1000;
    const h = harness({ now: () => now, maxAgeMs: 10_000 });
    try {
      const stale = h.store.create('old.mp4', 10);
      now = 5000;
      const fresh = h.store.create('new.mp4', 10);
      now = 12_000; // stale is 11s idle, fresh 7s
      h.store.sweep();
      expect(h.store.get(stale.id)).toBeNull();
      expect(h.store.get(fresh.id)).not.toBeNull();

      h.store.discard(fresh.id);
      expect(h.store.get(fresh.id)).toBeNull();
      // Nothing left behind on disk either.
      expect(() => readFileSync(join(h.dir, 'videos-partial', `${fresh.id}.part`))).toThrow();
    } finally {
      h.cleanup();
    }
  });
});

describe('ResumableUploadStore — hardening (adversarial review findings)', () => {
  it('caps concurrent sessions and the aggregate staged budget (disk-exhaustion guard)', () => {
    const h = harness({ maxSessions: 2, maxAggregateBytes: 150 });
    try {
      h.store.create('a.mp4', 100);
      // Aggregate budget: 100 already reserved, 60 more would burst 150.
      expect(() => h.store.create('b.mp4', 60)).toThrow(ResumableUploadError);
      const b = h.store.create('b.mp4', 40);
      // Session cap: two live sessions is the limit.
      expect(() => h.store.create('c.mp4', 1)).toThrow(ResumableUploadError);
      // Freeing a session frees its reservation.
      h.store.discard(b.id);
      expect(() => h.store.create('c.mp4', 40)).not.toThrow();
    } finally {
      h.cleanup();
    }
  });

  it('serializes transfers per session: a second concurrent append is refused, not interleaved', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      const slow = new Readable({ read() {} }); // stays open until we push
      const first = h.store.append(up.id, 0, slow);
      const err = await h.store
        .append(up.id, 0, stream(mp4(100).slice(0, 10)))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ResumableUploadError);
      expect((err as ResumableUploadError).code).toBe('locked');
      slow.push(Buffer.from(mp4(100).slice(0, 60)));
      slow.push(null);
      expect(await first).toBe(60); // the in-flight transfer is unharmed
    } finally {
      h.cleanup();
    }
  });

  it('refuses to complete while an append is in flight', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      const slow = new Readable({ read() {} });
      const inflight = h.store.append(up.id, 0, slow);
      const err = await h.store.complete(up.id, memoryAssetStore()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ResumableUploadError);
      expect((err as ResumableUploadError).code).toBe('locked');
      slow.push(Buffer.from(mp4(100)));
      slow.push(null);
      await inflight;
    } finally {
      h.cleanup();
    }
  });

  it('settles the append and releases the session when the client disconnects without an error', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      const dying = new Readable({ read() {} });
      const pending = h.store.append(up.id, 0, dying);
      dying.push(Buffer.from(mp4(100).slice(0, 30)));
      // A browser abort surfaces as destroy-without-error: only 'close' fires.
      setTimeout(() => dying.destroy(), 5);
      await expect(pending).rejects.toThrow(); // never hangs
      // The partial keeps the durably-written bytes and the session stays resumable.
      const after = h.store.get(up.id);
      expect(after).not.toBeNull();
      await h.store.append(up.id, after!.offset, stream(mp4(100).slice(after!.offset)));
      expect(h.store.get(up.id)?.offset).toBe(100);
    } finally {
      h.cleanup();
    }
  });

  it('does not resurrect a session discarded while its last meta write raced', async () => {
    const h = harness();
    try {
      const up = h.store.create('clip.mp4', 100);
      await h.store.append(up.id, 0, stream(mp4(100).slice(0, 40)));
      h.store.discard(up.id);
      // A late append against the discarded id must not recreate meta or a part file.
      await expect(h.store.append(up.id, 40, stream(mp4(10)))).rejects.toThrow();
      expect(h.store.get(up.id)).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it('pre-checks the asset-store budget before finalize copies the partial', async () => {
    const h = harness();
    try {
      const tiny = memoryAssetStore({ maxTotalBytes: 50 });
      const up = h.store.create('clip.mp4', 100);
      await h.store.append(up.id, 0, stream(mp4(100)));
      const err = await h.store.complete(up.id, tiny).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AssetQuotaError); // refused BEFORE the second full copy
    } finally {
      h.cleanup();
    }
  });
});
