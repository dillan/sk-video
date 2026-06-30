import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** A VAPID (RFC 8292) application-server keypair. The public key is handed to browsers; the private
 * key signs the JWT that authenticates our pushes to the vendor push service. */
export interface IVapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Injected file IO so key persistence is unit-tested without disk. */
export interface IVapidIo {
  read: () => string | null;
  write: (data: string) => void;
}

function isKeys(value: unknown): value is IVapidKeys {
  const v = value as Record<string, unknown> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.publicKey === 'string' &&
    typeof v.privateKey === 'string'
  );
}

/**
 * Load the persisted VAPID keypair, or generate + persist one on first run. The key is STABLE for the
 * life of the install: a browser's subscription is bound to the public key it subscribed with, so
 * rotating the key would silently orphan every existing subscription. Hence we persist and reuse,
 * regenerating only when the file is absent or corrupt.
 */
export function loadOrCreateVapidKeys(io: IVapidIo, generate: () => IVapidKeys): IVapidKeys {
  const existing = io.read();
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (isKeys(parsed)) return parsed;
    } catch {
      // fall through to regenerate
    }
  }
  const keys = generate();
  io.write(JSON.stringify(keys));
  return keys;
}

/** Default file IO for the VAPID keypair: an owner-only JSON file in the plugin data dir. */
export function fileVapidIo(dataDir: string, name = 'vapid.json'): IVapidIo {
  const file = join(dataDir, name);
  return {
    read: () => (existsSync(file) ? readFileSync(file, 'utf8') : null),
    write: (data) => {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(file, data, { mode: 0o600 });
    },
  };
}
