import { createHash } from 'node:crypto';

/**
 * Pure integrity helpers. The clip, snapshot and telemetry bytes are all in memory at write time, so
 * the per-asset hash is a synchronous hashBytes (no streaming, no IO, fully unit-testable). The
 * per-asset digests fold with the core manifest fields into one canonical bundle digest. This is
 * tamper-evident-ish self-consistency only — explicitly NOT a signature / chain of custody.
 */

/** SHA-256 hex of a blob. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Canonical SHA-256 over id + createdAt + the assets (sorted by id) — order-independent and stable. */
export function computeBundleDigest(core: {
  id: string;
  createdAt: number;
  assets: { id: string; sha256: string; size: number }[];
}): string {
  const canonical = {
    id: core.id,
    createdAt: core.createdAt,
    assets: [...core.assets]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => ({ id: a.id, sha256: a.sha256, size: a.size })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
