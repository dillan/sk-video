import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AssetStore,
  type IAssetIndexPersistence,
  type IBlobStore,
  type IVideoAsset,
} from './asset-store';
import type { IQuotaLimits } from './quota';

/** File-backed asset index (id → metadata) as owner-only JSON in the plugin data directory. */
export class FileAssetIndexPersistence implements IAssetIndexPersistence {
  private readonly file: string;

  constructor(dataDir: string, filename = 'videos.json') {
    this.file = join(dataDir, filename);
  }

  load(): Record<string, IVideoAsset> {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, IVideoAsset>)
        : {};
    } catch {
      return {};
    }
  }

  save(index: Record<string, IVideoAsset>): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, JSON.stringify(index, null, 2), { mode: 0o600 });
  }
}

/** Stores blobs as owner-only files named by their opaque id under a `videos/` directory. */
export class FileBlobStore implements IBlobStore {
  private readonly dir: string;

  constructor(dataDir: string, subdir = 'videos') {
    this.dir = join(dataDir, subdir);
  }

  write(id: string, bytes: Uint8Array): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.pathFor(id), bytes, { mode: 0o600 });
  }

  remove(id: string): void {
    rmSync(this.pathFor(id), { force: true });
  }

  has(id: string): boolean {
    return existsSync(this.pathFor(id));
  }

  pathFor(id: string): string {
    return join(this.dir, id);
  }
}

/** Builds a file-backed AssetStore rooted at the plugin data directory. */
export function createFileAssetStore(dataDir: string, limits?: IQuotaLimits): AssetStore {
  return new AssetStore({
    index: new FileAssetIndexPersistence(dataDir),
    blobs: new FileBlobStore(dataDir),
    limits,
  });
}
