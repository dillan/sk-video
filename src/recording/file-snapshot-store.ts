import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ISnapshotMetadata, ISnapshotStore } from './snapshot-service';

/** Snapshot ids must be a plain safe slug (uuid form qualifies) — used as the on-disk filename. */
export function isValidSnapshotId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

/**
 * Stores each snapshot as two owner-only files under a `snapshots/` directory: the JPEG blob and a
 * JSON telemetry sidecar, both named by the opaque snapshot id. Mirrors the hardened uploads store's
 * file conventions (0600, id-as-filename, no client-controlled paths).
 */
export class FileSnapshotStore implements ISnapshotStore {
  private readonly dir: string;

  constructor(dataDir: string, subdir = 'snapshots') {
    this.dir = join(dataDir, subdir);
  }

  save(bytes: Uint8Array, meta: ISnapshotMetadata): void {
    if (!isValidSnapshotId(meta.id)) {
      throw new Error('invalid snapshot id');
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.blobPath(meta.id), bytes, { mode: 0o600 });
    writeFileSync(this.metaPath(meta.id), JSON.stringify(meta, null, 2), { mode: 0o600 });
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
