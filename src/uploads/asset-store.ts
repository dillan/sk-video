import { randomUUID } from 'node:crypto';
import { sniffVideoType } from './video-sniff';
import { checkQuota, type IQuotaLimits, type IQuotaUsage } from './quota';

/** Metadata for one stored video. The blob itself lives next to this under an opaque id. */
export interface IVideoAsset {
  id: string;
  /** Sanitized original name, for display only — never used as the on-disk filename. */
  name: string;
  contentType: string;
  size: number;
  createdAt: number;
}

/** Persistence for the asset index (the JSON map of id → metadata). */
export interface IAssetIndexPersistence {
  load(): Record<string, IVideoAsset>;
  save(index: Record<string, IVideoAsset>): void;
}

/** A blob streamed to temporary storage, awaiting validation before it is committed under an id. */
export interface IStagedBlob {
  /** Opaque handle to the staged bytes (a temp path on disk, or a key in tests). */
  ref: string;
  size: number;
  /** The first bytes, so the magic-byte sniff runs without reading the whole blob into memory. */
  head: Uint8Array;
  outcome: 'ok' | 'too-large' | 'error';
}

/** Storage for the opaque blobs, keyed by asset id. */
export interface IBlobStore {
  write(id: string, bytes: Uint8Array): void;
  remove(id: string): void;
  has(id: string): boolean;
  /** Absolute path to the blob, for Range streaming in the route. */
  pathFor(id: string): string;
  /** Stream a blob to temp storage, capped at maxBytes, capturing its size + head for validation. */
  stageFromStream(stream: NodeJS.ReadableStream, maxBytes: number): Promise<IStagedBlob>;
  /** Atomically commit a previously staged blob under an id. */
  commitStaged(staged: IStagedBlob, id: string): void;
  /** Discard a staged blob that will not be committed (rejected / quota / error). */
  discardStaged(staged: IStagedBlob): void;
}

/** Thrown when an upload isn't an allowed video container. */
export class AssetRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetRejectedError';
  }
}

/** Thrown when an upload would exceed a storage limit. */
export class AssetQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetQuotaError';
  }
}

/** Thrown when the upload stream itself failed (aborted / errored mid-body). */
export class AssetUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetUploadError';
  }
}

const DEFAULT_LIMITS: IQuotaLimits = {
  maxFileBytes: 2 * 1024 * 1024 * 1024, // 2 GiB per file
  maxTotalBytes: 10 * 1024 * 1024 * 1024, // 10 GiB total
  maxFileCount: 100,
};

/** Asset ids and on-disk names must be a plain safe slug (uuid form qualifies). */
export function isValidAssetId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

/** Strips any path components and unsafe characters from a client-supplied filename (display only). */
export function sanitizeFilename(name: string | undefined): string {
  if (!name) {
    return '';
  }
  const base = name.split(/[\\/]/).pop() ?? '';
  return base
    .replace(CONTROL_CHARS, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim()
    .slice(0, 120);
}

// eslint-disable-next-line no-control-regex -- stripping control chars is the point
const CONTROL_CHARS = new RegExp('[\u0000-\u001f\u007f]', 'g');

export interface IAssetStoreOptions {
  index: IAssetIndexPersistence;
  blobs: IBlobStore;
  limits?: IQuotaLimits;
  idGen?: () => string;
  now?: () => number;
}

/**
 * Stores uploaded videos: validates by magic bytes, enforces the quota model, writes the blob under
 * an opaque id, and keeps a metadata index. The client's filename and Content-Type are never trusted.
 */
export class AssetStore {
  private readonly index: IAssetIndexPersistence;
  private readonly blobs: IBlobStore;
  private readonly limits: IQuotaLimits;
  private readonly idGen: () => string;
  private readonly now: () => number;
  private assets: Record<string, IVideoAsset>;

  constructor(options: IAssetStoreOptions) {
    this.index = options.index;
    this.blobs = options.blobs;
    this.limits = options.limits ?? DEFAULT_LIMITS;
    this.idGen = options.idGen ?? (() => randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.assets = { ...this.index.load() };
  }

  list(): IVideoAsset[] {
    return Object.values(this.assets);
  }

  get(id: string): IVideoAsset | null {
    return this.assets[id] ?? null;
  }

  pathFor(id: string): string {
    return this.blobs.pathFor(id);
  }

  usage(): IQuotaUsage {
    const values = Object.values(this.assets);
    return {
      totalBytes: values.reduce((sum, a) => sum + a.size, 0),
      fileCount: values.length,
    };
  }

  /** Validates, quota-checks, and stores a new video. Throws AssetRejectedError / AssetQuotaError. */
  add(bytes: Uint8Array, originalName?: string): IVideoAsset {
    const sniff = sniffVideoType(bytes);
    if (!sniff) {
      throw new AssetRejectedError('unsupported or unrecognized video format');
    }
    const quota = checkQuota(this.usage(), bytes.length, this.limits);
    if (!quota.ok) {
      throw new AssetQuotaError(quota.reason);
    }

    const id = this.idGen();
    if (!isValidAssetId(id)) {
      throw new Error('generated an invalid asset id');
    }
    this.blobs.write(id, bytes);
    const asset: IVideoAsset = {
      id,
      name: sanitizeFilename(originalName) || id,
      contentType: sniff.contentType,
      size: bytes.length,
      createdAt: this.now(),
    };
    this.assets = { ...this.assets, [id]: asset };
    this.index.save(this.assets);
    return asset;
  }

  /**
   * Streams an upload straight to disk (never buffering the whole body in memory), then validates by
   * magic bytes + quota and commits it atomically. Throws AssetUploadError / AssetRejectedError /
   * AssetQuotaError; the staged temp blob is always discarded on any failure.
   */
  async addFromStream(stream: NodeJS.ReadableStream, originalName?: string): Promise<IVideoAsset> {
    const staged = await this.blobs.stageFromStream(stream, this.limits.maxFileBytes);
    if (staged.outcome !== 'ok') {
      this.blobs.discardStaged(staged);
      throw staged.outcome === 'too-large'
        ? new AssetQuotaError('file exceeds the maximum allowed size')
        : new AssetUploadError('upload failed');
    }
    try {
      const sniff = sniffVideoType(staged.head);
      if (!sniff) {
        throw new AssetRejectedError('unsupported or unrecognized video format');
      }
      const quota = checkQuota(this.usage(), staged.size, this.limits);
      if (!quota.ok) {
        throw new AssetQuotaError(quota.reason);
      }
      const id = this.idGen();
      if (!isValidAssetId(id)) {
        throw new Error('generated an invalid asset id');
      }
      this.blobs.commitStaged(staged, id);
      const asset: IVideoAsset = {
        id,
        name: sanitizeFilename(originalName) || id,
        contentType: sniff.contentType,
        size: staged.size,
        createdAt: this.now(),
      };
      this.assets = { ...this.assets, [id]: asset };
      this.index.save(this.assets);
      return asset;
    } catch (err) {
      this.blobs.discardStaged(staged);
      throw err;
    }
  }

  delete(id: string): boolean {
    if (!this.assets[id]) {
      return false;
    }
    const next = { ...this.assets };
    delete next[id];
    this.assets = next;
    this.index.save(this.assets);
    this.blobs.remove(id);
    return true;
  }
}
