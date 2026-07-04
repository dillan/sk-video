import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../util/atomic-write';

/**
 * Per-camera "last seen producing" tracker, so the console can honestly distinguish a camera that
 * is idle (go2rtc connects lazily), one that has NEVER produced since the plugin started, and one
 * that went dark after being live. Live state is in-memory, but a persisted snapshot can seed it so
 * an outage that spans a plugin/server restart stays visible instead of silently resetting.
 * `trackedSince` gives the in-process horizon, so "never seen" is always scoped ("since HH:MM"),
 * never an absolute claim about the camera. Every health read (route or watchdog poll) stamps it;
 * no extra polling is added.
 */

export interface ILastGood {
  /** Epoch ms when this camera last had an active producer; null = never since `trackedSince`. */
  lastGoodAt: number | null;
  /** Epoch ms when tracking began (plugin start) — the honest horizon for "never seen". */
  trackedSince: number;
}

export interface ILastGoodOptions {
  /** Persisted lastGoodAt stamps from a previous run, keyed by camera id. */
  seed?: Record<string, number>;
}

export class LastGoodTracker {
  private readonly seen = new Map<string, number>();
  private readonly since: number;

  constructor(
    private readonly now: () => number = Date.now,
    options: ILastGoodOptions = {},
  ) {
    this.since = this.now();
    for (const [id, at] of Object.entries(options.seed ?? {})) {
      if (typeof at === 'number' && Number.isFinite(at)) {
        this.seen.set(id, at);
      }
    }
  }

  /** Stamp a health observation; only an online reading updates the timestamp. */
  note(cameraId: string, online: boolean): void {
    if (online) {
      this.seen.set(cameraId, this.now());
    }
  }

  get(cameraId: string): ILastGood {
    return { lastGoodAt: this.seen.get(cameraId) ?? null, trackedSince: this.since };
  }

  /** Drop state for a removed camera so a re-added id starts honest. */
  forget(cameraId: string): void {
    this.seen.delete(cameraId);
  }

  /** The stamped cameras as a persistable snapshot (input shape for `seed`). */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.seen);
  }
}

const SNAPSHOT_FILE = 'last-good.json';

/** Load the persisted last-good snapshot; empty on first run or a corrupt file — never throws. */
export function loadLastGoodSnapshot(dataDir: string): Record<string, number> {
  const file = join(dataDir, SNAPSHOT_FILE);
  if (!existsSync(file)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

/** Persist the snapshot (atomic, owner-only). Best-effort: persistence must never break polling. */
export function saveLastGoodSnapshot(dataDir: string, snapshot: Record<string, number>): void {
  try {
    writeJsonAtomic(join(dataDir, SNAPSHOT_FILE), snapshot);
  } catch {
    // best-effort — a full disk must not take down the health poll
  }
}
