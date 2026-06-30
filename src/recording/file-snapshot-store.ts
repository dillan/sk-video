import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ISnapshotMetadata, ISnapshotStore } from './snapshot-service';

/** Snapshot ids must be a plain safe slug (uuid form qualifies) — used as the on-disk filename. */
export function isValidSnapshotId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

// Bound snapshot growth so a long-running boat (MOB/anchor/incident captures over months) can't fill
// the disk. Conservative defaults; pruning is oldest-first by capture time.
const DEFAULT_MAX_COUNT = 1000; // the hard bound on disk growth
const DEFAULT_MAX_AGE_MS = Infinity; // age pruning is opt-in; count alone bounds growth

export interface IFileSnapshotStoreOptions {
  maxCount?: number;
  maxAgeMs?: number;
  now?: () => number;
}

/**
 * Stores each snapshot as two owner-only files under a `snapshots/` directory: the JPEG blob and a
 * JSON telemetry sidecar, both named by the opaque snapshot id. Mirrors the hardened uploads store's
 * file conventions (0600, id-as-filename, no client-controlled paths). Growth is bounded: each save
 * prunes snapshots past the count/age budget, oldest first.
 */
export class FileSnapshotStore implements ISnapshotStore {
  private readonly dir: string;
  private readonly maxCount: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(dataDir: string, subdir = 'snapshots', options: IFileSnapshotStoreOptions = {}) {
    this.dir = join(dataDir, subdir);
    this.maxCount = options.maxCount ?? DEFAULT_MAX_COUNT;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  save(bytes: Uint8Array, meta: ISnapshotMetadata): void {
    if (!isValidSnapshotId(meta.id)) {
      throw new Error('invalid snapshot id');
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.blobPath(meta.id), bytes, { mode: 0o600 });
    writeFileSync(this.metaPath(meta.id), JSON.stringify(meta, null, 2), { mode: 0o600 });
    this.prune();
  }

  /** Delete snapshots past the age limit, then the oldest beyond the count budget. Best-effort. */
  private prune(): void {
    const all = this.list();
    const cutoff = this.now() - this.maxAgeMs;
    const tooOld = all.filter((m) => m.createdAt < cutoff);
    const fresh = all
      .filter((m) => m.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt);
    const overflow = fresh.slice(this.maxCount);
    for (const meta of [...tooOld, ...overflow]) {
      rmSync(this.blobPath(meta.id), { force: true });
      rmSync(this.metaPath(meta.id), { force: true });
    }
  }

  get(id: string): ISnapshotMetadata | null {
    if (!isValidSnapshotId(id) || !existsSync(this.metaPath(id))) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(this.metaPath(id), 'utf8')) as ISnapshotMetadata;
    } catch {
      return null;
    }
  }

  list(): ISnapshotMetadata[] {
    if (!existsSync(this.dir)) {
      return [];
    }
    const out: ISnapshotMetadata[] = [];
    for (const file of readdirSync(this.dir)) {
      if (file.endsWith('.json')) {
        const meta = this.get(file.slice(0, -'.json'.length));
        if (meta) {
          out.push(meta);
        }
      }
    }
    return out;
  }

  /** Absolute path to the JPEG blob, for serving it back later. */
  blobPath(id: string): string {
    return join(this.dir, `${id}.jpg`);
  }

  private metaPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}
