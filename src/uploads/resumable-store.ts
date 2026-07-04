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
import { sanitizeFilename, type AssetStore, type IVideoAsset } from './asset-store';

/**
 * Staging area for resumable uploads: a client declares a file's size, appends bytes in order
 * (each append verified against the current offset, so a dropped connection resumes exactly where
 * it died — even across a plugin restart, since partials live on disk), and finalizes through the
 * existing AssetStore path, which is where the magic-byte sniff, the quota model, and the atomic
 * commit already live. Partials never count as videos; stale ones are swept.
 */

export type TResumableErrorCode = 'unknown' | 'offset-mismatch' | 'overflow' | 'incomplete';

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
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // matches the asset store's per-file cap
const SUBDIR = 'videos-partial';
const ID_RE = /^[A-Za-z0-9-]+$/;

export class ResumableUploadStore {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly maxSizeBytes: number;

  constructor(dataDir: string, options: IResumableStoreOptions = {}) {
    this.dir = join(dataDir, SUBDIR);
    this.now = options.now ?? (() => Date.now());
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  create(name: string | undefined, size: number): IResumableUpload {
    if (!Number.isInteger(size) || size <= 0) {
      throw new ResumableUploadError('a positive size is required', 'overflow');
    }
    if (size > this.maxSizeBytes) {
      throw new ResumableUploadError('file exceeds the maximum allowed size', 'overflow');
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
      ...{ updatedAt: meta.updatedAt },
    };
  }

  /** Append a chunk at `offset`; resolves the new offset. The partial survives stream errors. */
  async append(id: string, offset: number, stream: NodeJS.ReadableStream): Promise<number> {
    const meta = this.readMeta(id);
    if (!meta) {
      throw new ResumableUploadError('unknown upload', 'unknown');
    }
    const current = this.partSize(id);
    if (offset !== current) {
      throw new ResumableUploadError(
        `append at ${offset} but the upload is at ${current}`,
        'offset-mismatch',
        current,
      );
    }
    const remaining = meta.size - current;

    let written = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const sink = createWriteStream(this.partPath(id), { flags: 'a', mode: 0o600 });
        let overflowed = false;
        stream.on('data', (chunk: Buffer) => {
          written += chunk.length;
          if (written > remaining) {
            overflowed = true;
            sink.destroy();
            (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
            reject(new ResumableUploadError('more bytes than the declared size', 'overflow'));
            return;
          }
          if (!sink.write(chunk)) {
            (stream as NodeJS.ReadableStream & { pause?: () => void }).pause?.();
            sink.once('drain', () =>
              (stream as NodeJS.ReadableStream & { resume?: () => void }).resume?.(),
            );
          }
        });
        stream.on('end', () => sink.end(() => resolve()));
        stream.on('error', (err) => {
          sink.destroy();
          if (!overflowed) reject(err);
        });
        sink.on('error', (err) => {
          if (!overflowed) reject(err);
        });
      });
    } catch (err) {
      if (err instanceof ResumableUploadError && err.code === 'overflow') {
        // A lying client gets no second try against the disk: the whole session goes.
        this.discard(id);
      }
      throw err;
    }

    writeJsonAtomic(this.metaPath(id), { ...meta, updatedAt: this.now() });
    return this.partSize(id);
  }

  /** Finalize into the asset store (sniff + quota + atomic commit) and remove the partial. */
  async complete(id: string, assets: AssetStore): Promise<IVideoAsset> {
    const meta = this.readMeta(id);
    if (!meta) {
      throw new ResumableUploadError('unknown upload', 'unknown');
    }
    const offset = this.partSize(id);
    if (offset !== meta.size) {
      throw new ResumableUploadError(
        `upload is at ${offset} of ${meta.size} bytes`,
        'incomplete',
        offset,
      );
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
        const meta = this.readMeta(id);
        if (!meta || meta.updatedAt < cutoff) {
          this.discard(id);
        }
      } else if (file.endsWith('.part')) {
        const id = file.slice(0, -'.part'.length);
        if (!this.readMeta(id)) {
          rmSync(join(this.dir, file), { force: true });
        }
      }
    }
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
