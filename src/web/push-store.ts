import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A browser Web Push subscription (RFC 8030 + RFC 8291), as handed to us by `pushManager.subscribe`.
 * The `endpoint` is a URL on the browser vendor's push service (FCM / Mozilla / Apple); `keys` are the
 * client's public key + auth secret used to encrypt the payload. We store these so the plugin can,
 * on a safety event, POST an encrypted notification to the endpoint. No third-party account is
 * involved — the Pi only ever makes outbound requests to that endpoint.
 */
export interface IPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  /** Epoch ms we first stored it. */
  createdAt: number;
}

/** Validate an untrusted subscription body before storing it. */
export function isValidSubscription(value: unknown): value is Omit<IPushSubscription, 'createdAt'> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.endpoint !== 'string') return false;
  // A push endpoint is always https — reject anything else so we never POST a payload over cleartext.
  if (!/^https:\/\//.test(v.endpoint)) return false;
  const keys = v.keys as Record<string, unknown> | undefined;
  return (
    typeof keys === 'object' &&
    keys !== null &&
    typeof keys.p256dh === 'string' &&
    keys.p256dh.length > 0 &&
    typeof keys.auth === 'string' &&
    keys.auth.length > 0
  );
}

export interface IPushStorePersistence {
  load(): IPushSubscription[];
  save(subs: IPushSubscription[]): void;
}

export interface IPushStoreOptions {
  persistence?: IPushStorePersistence;
  now?: () => number;
}

/** File persistence: all subscriptions in one owner-only JSON file. */
export class FilePushStorePersistence implements IPushStorePersistence {
  private readonly file: string;
  constructor(dataDir: string, name = 'push-subscriptions.json') {
    this.file = join(dataDir, name);
  }
  load(): IPushSubscription[] {
    if (!existsSync(this.file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(parsed) ? (parsed as IPushSubscription[]) : [];
    } catch {
      return []; // a corrupt store must never crash the plugin
    }
  }
  save(subs: IPushSubscription[]): void {
    mkdirSync(this.file.slice(0, this.file.lastIndexOf('/')) || '.', { recursive: true });
    writeFileSync(this.file, JSON.stringify(subs), { mode: 0o600 });
  }
}

/** Stores the set of devices that opted in to safety push, keyed (deduped) by endpoint. */
export class PushStore {
  private readonly persistence: IPushStorePersistence;
  private readonly now: () => number;
  private subs: IPushSubscription[];

  constructor(options: IPushStoreOptions = {}) {
    this.persistence = options.persistence ?? { load: () => [], save: () => undefined };
    this.now = options.now ?? (() => Date.now());
    this.subs = this.persistence.load();
  }

  /** Add (or replace, by endpoint) a subscription. */
  add(sub: Omit<IPushSubscription, 'createdAt'>): IPushSubscription {
    const stored: IPushSubscription = {
      endpoint: sub.endpoint,
      keys: sub.keys,
      ...(sub.expirationTime !== undefined ? { expirationTime: sub.expirationTime } : {}),
      createdAt: this.now(),
    };
    this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
    this.subs.push(stored);
    this.persistence.save(this.subs);
    return stored;
  }

  /** Remove a subscription by endpoint (explicit unsubscribe, or pruning a dead one). */
  remove(endpoint: string): boolean {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    if (this.subs.length === before) return false;
    this.persistence.save(this.subs);
    return true;
  }

  list(): IPushSubscription[] {
    return [...this.subs];
  }
}
