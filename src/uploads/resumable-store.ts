import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeJsonAtomic } from '../util/atomic-write';
import {
  AssetQuotaError,
  sanitizeFilename,
  type AssetStore,
  type IVideoAsset,
} from './asset-store';

/**
 * Staging area for resumable uploads: a client declares a file's size, appends bytes in order
 * (each append verified against the current offset, so a dropped connection resumes exactly where
 * it died — even across a plugin restart, since partials live on disk), and finalizes through the
 * existing AssetStore path, which is where the magic-byte sniff, the quota model, and the atomic
 * commit already live. Partials never count as videos.
 *
 * Hardened per adversarial review: sessions are capped in count AND aggregate declared bytes (a
 * caller cannot fill the disk with partials the video quota never sees), transfers are serialized
 * per session (concurrent appends would interleave into a corrupt partial), a client disconnect
 * settles the append deterministically (no leaked file descriptors), and finalize pre-checks the
 * asset-store budget before making its staging copy.
 */

export type TResumableErrorCode =
  'unknown' | 'offset-mismatch' | 'overflow' | 'incomplete' | 'locked' | 'busy';

export class ResumableUploadError extends Error {
  constructor(
    message: string,
    public readonly code: TResumableErrorCode,
    /** The session's current offset — what a resuming client needs after a mismatch. */
    public readonly currentOffset?: number,
  ) {
    super(message);
    this.name = 'ResumableUploadError';
  }
}

export interface IResumableUpload {
  id: string;
  name: string;
  /** Declared total size in bytes — appends beyond it are refused. */
  size: number;
  /** Bytes durably staged so far. */
  offset: number;
  updatedAt: number;
}

interface IPartialMeta {
  name: string;
  size: number;
  updatedAt: number;
}

export interface IResumableStoreOptions {
  now?: () => number;
  /** Idle partials older than this are swept. */
  maxAgeMs?: number;
  /** Hard per-file cap, mirroring the asset store's own limit. */
  maxSizeBytes?: number;
  /** Concurrent-session cap: more simultaneous uploads than any boat needs, fewer than a DoS. */
  maxSessions?: number;
  /** Aggregate DECLARED bytes across live sessions — the staged-disk budget. */
  maxAggregateBytes?: number;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // matches the asset store's per-file cap
const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_MAX_AGGREGATE_BYTES = 10 * 1024 * 1024 * 1024; // mirrors the video quota ceiling
const SUBDIR = 'videos-partial';
const ID_RE = /^[A-Za-z0-9-]+$/;

export class ResumableUploadStore {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly maxSizeBytes: number;
  private readonly maxSessions: number;
  private readonly maxAggregateBytes: number;
  /** Session ids with a transfer (append/complete) in flight — the per-session lock. */
  private readonly inflight = new Set<string>();

  constructor(dataDir: string, options: IResumableStoreOptions = {}) {
    this.dir = join(dataDir, SUBDIR);
    this.now = options.now ?? (() => Date.now());
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxAggregateBytes = options.maxAggregateBytes ?? DEFAULT_MAX_AGGREGATE_BYTES;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  create(name: string | undefined, size: number): IResumableUpload {
    if (!Number.isInteger(size) || size <= 0) {
      throw new ResumableUploadError('a positive size is required', 'overflow');
    }
    if (size > this.maxSizeBytes) {
      throw new ResumableUploadError('file exceeds the maximum allowed size', 'overflow');
    }
    const live = this.liveSessions();
    if (live.count >= this.maxSessions) {
      throw new ResumableUploadError('too many uploads in progress — try again shortly', 'busy');
    }
    if (live.declaredBytes + size > this.maxAggregateBytes) {
      throw new ResumableUploadError(
        'not enough staging space for this upload right now',
        'overflow',
      );
    }
    const id = randomUUID();
    const meta: IPartialMeta = {
      name: sanitizeFilename(name) || id,
      size,
      updatedAt: this.now(),
    };
    writeJsonAtomic(this.metaPath(id), meta);
    return { id, name: meta.name, size, offset: 0, updatedAt: meta.updatedAt };
  }

  get(id: string): IResumableUpload | null {
    const meta = this.readMeta(id);
    if (!meta) {
      return null;
    }
    return {
      id,
      name: meta.name,
      size: meta.size,
      offset: this.partSize(id),
      updatedAt: meta.updatedAt,
    };
  }

  /** Append a chunk at `offset`; resolves the new offset. The partial survives stream errors. */
  async append(id: string, offset: number, stream: NodeJS.ReadableStream): Promise<number> {
    const meta = this.readMeta(id);
    if (!meta) {
      throw new ResumableUploadError('unknown upload', 'unknown');
    }
    this.lock(id);
    try {
      const current = this.partSize(id);
      if (offset !== current) {
        throw new ResumableUploadError(
          `append at ${offset} but the upload is at ${current}`,
          'offset-mismatch',
          current,
        );
      }
      const remaining = meta.size - current;

      try {
        await this.drainToPart(id, stream, remaining);
      } catch (err) {
        if (err instanceof ResumableUploadError && err.code === 'overflow') {
          // A lying client gets no second try against the disk: the whole session goes.
          this.discard(id);
        }
        throw err;
      }

      // The session may have been discarded while the last bytes flushed — never resurrect it.
      if (this.readMeta(id)) {
        writeJsonAtomic(this.metaPath(id), { ...meta, updatedAt: this.now() });
      }
      return this.partSize(id);
    } finally {
      this.inflight.delete(id);
    }
  }

  /** Finalize into the asset store (sniff + quota + atomic commit) and remove the partial. */
  async complete(id: string, assets: AssetStore): Promise<IVideoAsset> {
    const meta = this.readMeta(id);
    if (!meta) {
      throw new ResumableUploadError('unknown upload', 'unknown');
    }
    this.lock(id);
    try {
      const offset = this.partSize(id);
      if (offset !== meta.size) {
        throw new ResumableUploadError(
          `upload is at ${offset} of ${meta.size} bytes`,
          'incomplete',
          offset,
        );
      }
      // Cheap budget pre-check before finalize copies the whole partial into staging.
      const room = assets.canAccept(meta.size);
      if (!room.ok) {
        this.discard(id);
        throw new AssetQuotaError(room.reason);
      }
      try {
        const asset = await assets.addFromStream(createReadStream(this.partPath(id)), meta.name);
        this.discard(id);
        return asset;
      } catch (err) {
        // Whatever the store refused (format, quota) won't change by re-sending the same bytes.
        this.discard(id);
        throw err;
      }
    } finally {
      this.inflight.delete(id);
    }
  }

  discard(id: string): void {
    if (!ID_RE.test(id)) {
      return;
    }
    rmSync(this.partPath(id), { force: true });
    rmSync(this.metaPath(id), { force: true });
  }

  /** Drop partials idle past the max age (and orphaned part files with no meta). */
  sweep(): void {
    const cutoff = this.now() - this.maxAgeMs;
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const file of names) {
      if (file.endsWith('.json')) {
        const id = file.slice(0, -'.json'.length);
        if (this.inflight.has(id)) {
          continue; // never sweep under a live transfer
        }
        const meta = this.readMeta(id);
        if (!meta || meta.updatedAt < cutoff) {
          this.discard(id);
        }
      } else if (file.endsWith('.part')) {
        const id = file.slice(0, -'.part'.length);
        if (!this.inflight.has(id) && !this.readMeta(id)) {
          rmSync(join(this.dir, file), { force: true });
        }
      }
    }
  }

  /** Acquire the per-session transfer lock or refuse — concurrent transfers would corrupt bytes. */
  private lock(id: string): void {
    if (this.inflight.has(id)) {
      throw new ResumableUploadError(
        'another transfer for this upload is in flight',
        'locked',
        this.partSize(id),
      );
    }
    this.inflight.add(id);
  }

  /** Count live sessions and their declared bytes (the staging reservation). */
  private liveSessions(): { count: number; declaredBytes: number } {
    let count = 0;
    let declaredBytes = 0;
    let names: string[] = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      /* an unreadable staging dir counts as empty */
    }
    for (const file of names) {
      if (!file.endsWith('.json')) continue;
      const meta = this.readMeta(file.slice(0, -'.json'.length));
      if (meta) {
        count += 1;
        declaredBytes += meta.size;
      }
    }
    return { count, declaredBytes };
  }

  /**
   * Stream the request body into the .part file, capped at `remaining` bytes. Settles exactly
   * once — including when the client disconnects without an error event ('close' only) — and
   * always releases the sink so no file descriptor outlives the request.
   */
  private drainToPart(id: string, stream: NodeJS.ReadableStream, remaining: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sink = createWriteStream(this.partPath(id), { flags: 'a', mode: 0o600 });
      let written = 0;
      let settled = false;
      let ended = false;

      const settle = (err?: unknown): void => {
        if (settled) return;
        settled = true;
        if (err === undefined) resolve();
        else reject(err instanceof Error ? err : new Error(String(err)));
      };
      /** Close the sink first so the fd never leaks, then settle. */
      const fail = (err: unknown): void => {
        if (settled) return;
        (stream as NodeJS.ReadableStream & { pause?: () => void }).pause?.();
        sink.destroy();
        sink.once('close', () => settle(err));
      };

      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        written += chunk.length;
        if (written > remaining) {
          fail(new ResumableUploadError('more bytes than the declared size', 'overflow'));
          return;
        }
        if (!sink.write(chunk)) {
          (stream as NodeJS.ReadableStream & { pause?: () => void }).pause?.();
          sink.once('drain', () =>
            (stream as NodeJS.ReadableStream & { resume?: () => void }).resume?.(),
          );
        }
      });
      stream.on('end', () => {
        ended = true;
        if (!settled) sink.end(() => settle());
      });
      stream.on('error', (err) => fail(err));
      // A browser abort can surface as destroy-without-error: only 'close' fires. The bytes that
      // reached the sink stay durable, so the client resumes from the reported offset.
      stream.on('close', () => {
        if (!ended) fail(new Error('client disconnected during upload'));
      });
      sink.on('error', (err) => fail(err));
    });
  }

  private metaPath(id: string): string {
    if (!ID_RE.test(id)) {
      throw new ResumableUploadError('unknown upload', 'unknown');
    }
    return join(this.dir, `${id}.json`);
  }

  private partPath(id: string): string {
    if (!ID_RE.test(id)) {
      throw new ResumableUploadError('unknown upload', 'unknown');
    }
    return join(this.dir, `${id}.part`);
  }

  private readMeta(id: string): IPartialMeta | null {
    if (!ID_RE.test(id)) {
      return null;
    }
    try {
      const raw = JSON.parse(readFileSync(this.metaPath(id), 'utf8')) as Partial<IPartialMeta>;
      if (typeof raw.name !== 'string' || typeof raw.size !== 'number') {
        return null;
      }
      return { name: raw.name, size: raw.size, updatedAt: raw.updatedAt ?? 0 };
    } catch {
      return null;
    }
  }

  private partSize(id: string): number {
    try {
      return existsSync(this.partPath(id)) ? statSync(this.partPath(id)).size : 0;
    } catch {
      return 0;
    }
  }
}
