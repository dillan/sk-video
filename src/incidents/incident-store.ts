import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../util/atomic-write';
import {
  isValidIncidentId,
  type IIncidentBundle,
  type IIncidentPatch,
} from './incident-validation';
import type { IBundleSummary } from './retention';

/**
 * File-backed atomic bundle store shared by the controller, resource provider and routes. Each bundle
 * is one per-id directory: `incidents/<id>/manifest.json` plus bare-id asset blobs. Assets are staged
 * under `incidents/.staging/<id>/` and made visible by a SINGLE same-filesystem renameSync, so a
 * crash mid-assembly leaves only an orphan staging dir (swept at startup) and the listed/served set
 * never contains a half-written bundle. Asset blobs carry no extension (manifest.json is the only
 * dotted file), and the opaque id is the sole traversal guard. Files are owner-only (0600).
 */

const STAGING = '.staging';
const MANIFEST = 'manifest.json';

export interface IIncidentStore {
  stageAsset(id: string, assetId: string, bytes: Uint8Array): void;
  publish(id: string, manifest: IIncidentBundle): void;
  abandon(id: string): void;
  /** Remove orphan staging dirs left by a crash; returns how many were removed. */
  sweepStaging(): number;
  list(): IIncidentBundle[];
  get(id: string): IIncidentBundle | null;
  summaries(): IBundleSummary[];
  assetPath(id: string, assetId: string): string;
  delete(id: string): boolean;
  patch(id: string, fields: IIncidentPatch): IIncidentBundle | null;
  usage(): { totalBytes: number; count: number };
}

function assertId(id: string): void {
  if (!isValidIncidentId(id)) {
    throw new Error('invalid incident id');
  }
}

function bundleBytes(manifest: IIncidentBundle): number {
  return manifest.assets.reduce((sum, a) => sum + a.size, 0);
}

export class FileIncidentStore implements IIncidentStore {
  private readonly dir: string;
  private readonly stagingDir: string;

  constructor(dataDir: string, subdir = 'incidents') {
    this.dir = join(dataDir, subdir);
    this.stagingDir = join(this.dir, STAGING);
  }

  stageAsset(id: string, assetId: string, bytes: Uint8Array): void {
    assertId(id);
    assertId(assetId);
    const dir = join(this.stagingDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, assetId), bytes, { mode: 0o600 });
  }

  publish(id: string, manifest: IIncidentBundle): void {
    assertId(id);
    const staged = join(this.stagingDir, id);
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, MANIFEST), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const target = join(this.dir, id);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    renameSync(staged, target); // same filesystem (staging is a subdir of incidents) => atomic
  }

  abandon(id: string): void {
    assertId(id);
    rmSync(join(this.stagingDir, id), { recursive: true, force: true });
  }

  sweepStaging(): number {
    if (!existsSync(this.stagingDir)) {
      return 0;
    }
    let removed = 0;
    for (const name of readdirSync(this.stagingDir)) {
      rmSync(join(this.stagingDir, name), { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  get(id: string): IIncidentBundle | null {
    if (!isValidIncidentId(id)) {
      return null;
    }
    const path = join(this.dir, id, MANIFEST);
    if (!existsSync(path)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as IIncidentBundle;
    } catch {
      return null;
    }
  }

  list(): IIncidentBundle[] {
    if (!existsSync(this.dir)) {
      return [];
    }
    const out: IIncidentBundle[] = [];
    for (const name of readdirSync(this.dir)) {
      if (name === STAGING) {
        continue;
      }
      const manifest = this.get(name);
      if (manifest) {
        out.push(manifest);
      }
    }
    return out;
  }

  summaries(): IBundleSummary[] {
    return this.list().map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      totalBytes: bundleBytes(m),
      pinned: m.pinned === true,
    }));
  }

  assetPath(id: string, assetId: string): string {
    assertId(id);
    assertId(assetId);
    return join(this.dir, id, assetId);
  }

  delete(id: string): boolean {
    if (!isValidIncidentId(id)) {
      return false;
    }
    const target = join(this.dir, id);
    if (!existsSync(target)) {
      return false;
    }
    rmSync(target, { recursive: true, force: true });
    return true;
  }

  patch(id: string, fields: IIncidentPatch): IIncidentBundle | null {
    const manifest = this.get(id);
    if (!manifest) {
      return null;
    }
    const updated: IIncidentBundle = {
      ...manifest,
      ...(fields.label !== undefined ? { label: fields.label } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      ...(fields.pinned !== undefined ? { pinned: fields.pinned } : {}),
    };
    // Atomic: a non-atomic O_TRUNC write here could wipe the only manifest copy on a power loss /
    // full disk, making the bundle (and any pinned evidence) vanish from the API and escape the quota.
    writeJsonAtomic(join(this.dir, id, MANIFEST), updated);
    return updated;
  }

  usage(): { totalBytes: number; count: number } {
    const all = this.list();
    return { totalBytes: all.reduce((sum, m) => sum + bundleBytes(m), 0), count: all.length };
  }
}
