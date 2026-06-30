import { renameSync, writeFileSync } from 'node:fs';

let seq = 0;

/**
 * Atomically write a file: write a temp sibling then rename it into place. A same-filesystem rename is
 * atomic, so a reader never sees a half-written file and a power loss mid-write can't truncate the
 * existing file to nothing (the original survives until the rename commits). The temp sibling shares
 * the destination directory so the rename stays on one filesystem.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600): void {
  const tmp = `${path}.tmp-${process.pid}-${++seq}`;
  writeFileSync(tmp, data, { mode });
  renameSync(tmp, path);
}

/** Atomically write a value as pretty-printed JSON. */
export function writeJsonAtomic(path: string, value: unknown, mode = 0o600): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), mode);
}
