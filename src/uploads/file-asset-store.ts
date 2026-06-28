import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  AssetStore,
  type IAssetIndexPersistence,
  type IBlobStore,
  type IStagedBlob,
  type IVideoAsset,
} from './asset-store';
import type { IQuotaLimits } from './quota';

/** Enough leading bytes for the magic-byte sniff (matroska reads up to 64). */
const HEAD_BYTES = 64;

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
  private stageSeq = 0;

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

  stageFromStream(stream: NodeJS.ReadableStream, maxBytes: number): Promise<IStagedBlob> {
    mkdirSync(this.dir, { recursive: true });
    const ref = join(this.dir, `.staging-${process.pid}-${++this.stageSeq}`);
    return new Promise<IStagedBlob>((resolve) => {
      const out = createWriteStream(ref, { mode: 0o600 });
      out.on('error', () => fail('error')); // a disk write failure must reject, not crash the process
      const headChunks: Buffer[] = [];
      let size = 0;
      let headLen = 0;
      let settled = false;
      const done = (outcome: IStagedBlob['outcome']): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ ref, size, head: new Uint8Array(Buffer.concat(headChunks)), outcome });
      };
      const fail = (outcome: 'too-large' | 'error'): void => {
        out.destroy();
        rmSync(ref, { force: true });
        done(outcome);
      };
      stream.on('data', (chunk: Buffer) => {
        if (settled) {
          return;
        }
        size += chunk.length;
        if (size > maxBytes) {
          (stream as Partial<{ destroy(): void }>).destroy?.();
          fail('too-large');
          return;
        }
        if (headLen < HEAD_BYTES) {
          const take = chunk.subarray(0, HEAD_BYTES - headLen);
          headChunks.push(Buffer.from(take));
          headLen += take.length;
        }
        // Respect backpressure so a slow disk can't grow the write buffer unbounded in memory.
        if (!out.write(chunk)) {
          stream.pause?.();
          out.once('drain', () => stream.resume?.());
        }
      });
      stream.on('end', () => {
        if (!settled) {
          out.end(() => done('ok'));
        }
      });
      stream.on('error', () => fail('error'));
    });
  }

  commitStaged(staged: IStagedBlob, id: string): void {
    mkdirSync(this.dir, { recursive: true });
    renameSync(staged.ref, this.pathFor(id));
  }

  discardStaged(staged: IStagedBlob): void {
    rmSync(staged.ref, { force: true });
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
