import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PushStore,
  FilePushStorePersistence,
  isValidSubscription,
  type IPushSubscription,
  type IPushStorePersistence,
} from './push-store';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sk-push-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mem(
  seed: IPushSubscription[] = [],
): IPushStorePersistence & { saved: IPushSubscription[] } {
  const box = { saved: [...seed] };
  return {
    saved: box.saved,
    load: () => [...box.saved],
    save: (subs) => {
      box.saved.length = 0;
      box.saved.push(...subs);
    },
  };
}

const sub = (endpoint: string): unknown => ({
  endpoint,
  keys: { p256dh: 'BPk_key', auth: 'auth_secret' },
});

describe('isValidSubscription', () => {
  it('accepts a well-formed https subscription', () => {
    expect(isValidSubscription(sub('https://fcm.googleapis.com/fcm/send/abc'))).toBe(true);
  });
  it('rejects a non-https endpoint, missing keys, or junk', () => {
    expect(isValidSubscription(sub('http://insecure/x'))).toBe(false);
    expect(isValidSubscription({ endpoint: 'https://x', keys: {} })).toBe(false);
    expect(isValidSubscription({ endpoint: 'https://x' })).toBe(false);
    expect(isValidSubscription(null)).toBe(false);
    expect(isValidSubscription('nope')).toBe(false);
  });
});

describe('PushStore', () => {
  it('adds a subscription, stamping createdAt, and lists it', () => {
    const store = new PushStore({ persistence: mem(), now: () => 1234 });
    const added = store.add(sub('https://push/a') as IPushSubscription);
    expect(added.createdAt).toBe(1234);
    expect(store.list().map((s) => s.endpoint)).toEqual(['https://push/a']);
  });

  it('dedupes by endpoint (re-subscribe replaces, never duplicates)', () => {
    const store = new PushStore({ persistence: mem() });
    store.add(sub('https://push/a') as IPushSubscription);
    store.add(sub('https://push/a') as IPushSubscription);
    expect(store.list()).toHaveLength(1);
  });

  it('removes by endpoint (dead-subscription pruning)', () => {
    const store = new PushStore({ persistence: mem() });
    store.add(sub('https://push/a') as IPushSubscription);
    store.add(sub('https://push/b') as IPushSubscription);
    expect(store.remove('https://push/a')).toBe(true);
    expect(store.list().map((s) => s.endpoint)).toEqual(['https://push/b']);
    expect(store.remove('https://push/missing')).toBe(false);
  });

  it('persists across instances via the file persistence', () => {
    const dir = tmp();
    const a = new PushStore({ persistence: new FilePushStorePersistence(dir) });
    a.add(sub('https://push/a') as IPushSubscription);
    const b = new PushStore({ persistence: new FilePushStorePersistence(dir) });
    expect(b.list().map((s) => s.endpoint)).toEqual(['https://push/a']);
  });

  it('starts empty on a corrupt store file rather than throwing', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'push-subscriptions.json'), 'not json{');
    expect(new FilePushStorePersistence(dir).load()).toEqual([]);
  });
});
