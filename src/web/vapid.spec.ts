import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateVapidKeys, fileVapidIo, type IVapidIo } from './vapid';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function io(initial: string | null): IVapidIo & { readonly written: string | null } {
  const box = { written: initial };
  return {
    get written() {
      return box.written;
    },
    read: () => box.written,
    write: (data) => {
      box.written = data;
    },
  };
}

describe('loadOrCreateVapidKeys', () => {
  it('generates and persists a keypair on first run', () => {
    const store = io(null);
    const generate = vi.fn(() => ({ publicKey: 'PUB', privateKey: 'PRIV' }));
    const keys = loadOrCreateVapidKeys(store, generate);
    expect(keys).toEqual({ publicKey: 'PUB', privateKey: 'PRIV' });
    expect(generate).toHaveBeenCalledOnce();
    expect(JSON.parse(store.written as string)).toEqual({ publicKey: 'PUB', privateKey: 'PRIV' });
  });

  it('reuses the persisted keypair on later runs (a rotated key would orphan every subscription)', () => {
    const store = io(JSON.stringify({ publicKey: 'SAVED_PUB', privateKey: 'SAVED_PRIV' }));
    const generate = vi.fn(() => ({ publicKey: 'NEW', privateKey: 'NEW' }));
    const keys = loadOrCreateVapidKeys(store, generate);
    expect(keys.publicKey).toBe('SAVED_PUB');
    expect(generate).not.toHaveBeenCalled();
  });

  it('regenerates when the persisted file is corrupt', () => {
    const store = io('not json{');
    const generate = vi.fn(() => ({ publicKey: 'PUB', privateKey: 'PRIV' }));
    const keys = loadOrCreateVapidKeys(store, generate);
    expect(keys.publicKey).toBe('PUB');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('persists the keypair to an owner-only file and reuses it on the next run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-vapid-'));
    dirs.push(dir);
    const gen = vi.fn(() => ({ publicKey: 'GENPUB', privateKey: 'GENPRIV' }));
    const first = loadOrCreateVapidKeys(fileVapidIo(dir), gen);
    expect(first.publicKey).toBe('GENPUB');
    expect((statSync(join(dir, 'vapid.json')).mode & 0o777).toString(8)).toBe('600');
    // A fresh io over the same dir reads the persisted key — generate is not called again.
    const gen2 = vi.fn(() => ({ publicKey: 'OTHER', privateKey: 'OTHER' }));
    const second = loadOrCreateVapidKeys(fileVapidIo(dir), gen2);
    expect(second.publicKey).toBe('GENPUB');
    expect(gen2).not.toHaveBeenCalled();
  });
});
