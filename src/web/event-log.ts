import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/**
 * One durable, append-only record of a safety/system event (MOB armed, incident captured, anchor
 * drag, camera went dark). Signal K notifications are current-state and vanish when cleared, so this
 * log is the only way "reconstruct what happened last night" becomes real. It is best-effort
 * evidence, not a certified VDR — same honesty posture as recordings/incidents.
 */
export interface ILoggedEvent {
  /** Opaque id. */
  id: string;
  /** Epoch ms the event was logged. */
  at: number;
  /** The notification key that produced it, e.g. `mob`, `incident`, `camera.bow.offline`. */
  type: string;
  /** Notification state at raise time (`emergency`/`alarm`/`alert`/`warn`/…), if any. */
  state?: string;
  /** Human-readable message at raise time, if any. */
  message?: string;
}

/** Pluggable storage so the store logic is unit-tested without disk. */
export interface IEventLogPersistence {
  load(): ILoggedEvent[];
  save(events: ILoggedEvent[]): void;
}

export interface IEventLogOptions {
  /** Hard cap on retained events; the oldest are pruned past it. */
  maxCount?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Injectable id generator for deterministic tests. */
  idGen?: () => string;
  /** Storage backend; defaults to {@link FileEventLogPersistence} when a path is given instead. */
  persistence?: IEventLogPersistence;
}

/** Options for a single newest-first page. */
export interface IEventLogQuery {
  /** Max rows to return. */
  limit?: number;
  /** Return only events strictly older than this epoch-ms (paging older). */
  before?: number;
}

// Conservative bound: a boat raising a handful of events a day keeps months of history well under this.
const DEFAULT_MAX_COUNT = 5000;
const DEFAULT_LIMIT = 200;

/**
 * File persistence: the whole log lives in one owner-only JSON file. Events are infrequent (safety
 * notifications, not a per-frame stream), so a read-modify-write per append is cheap and keeps the
 * on-disk form trivially inspectable.
 */
export class FileEventLogPersistence implements IEventLogPersistence {
  private readonly file: string;

  constructor(dataDir: string, name = 'events.json') {
    this.file = join(dataDir, name);
  }

  load(): ILoggedEvent[] {
    if (!existsSync(this.file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(parsed) ? (parsed as ILoggedEvent[]) : [];
    } catch {
      // A corrupt log must never crash the plugin; start fresh rather than throw.
      return [];
    }
  }

  save(events: ILoggedEvent[]): void {
    mkdirSync(this.file.slice(0, this.file.lastIndexOf('/')) || '.', { recursive: true });
    writeFileSync(this.file, JSON.stringify(events), { mode: 0o600 });
  }
}

export class EventLog {
  private readonly persistence: IEventLogPersistence;
  private readonly maxCount: number;
  private readonly now: () => number;
  private readonly idGen: () => string;
  /** Held in chronological (oldest-first) order; list() reverses for newest-first output. */
  private events: ILoggedEvent[];

  constructor(options: IEventLogOptions = {}) {
    this.persistence = options.persistence ?? { load: () => [], save: () => undefined };
    this.maxCount = options.maxCount ?? DEFAULT_MAX_COUNT;
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
    this.events = this.persistence.load();
  }

  /** Append one event, stamping its id + time, pruning the oldest past the budget, and persisting. */
  append(event: { type: string; state?: string; message?: string; at?: number }): ILoggedEvent {
    const logged: ILoggedEvent = {
      id: this.idGen(),
      at: event.at ?? this.now(),
      type: event.type,
      ...(event.state !== undefined ? { state: event.state } : {}),
      ...(event.message !== undefined ? { message: event.message } : {}),
    };
    this.events.push(logged);
    if (this.events.length > this.maxCount) {
      this.events = this.events.slice(this.events.length - this.maxCount);
    }
    this.persistence.save(this.events);
    return logged;
  }

  /** Newest-first page of events, optionally bounded by a limit and a strictly-older-than cursor. */
  list(query: IEventLogQuery = {}): ILoggedEvent[] {
    const limit = query.limit ?? DEFAULT_LIMIT;
    let rows = [...this.events].reverse();
    if (query.before !== undefined) {
      rows = rows.filter((e) => e.at < (query.before as number));
    }
    return rows.slice(0, limit);
  }
}
