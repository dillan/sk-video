import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ICamera } from './camera-validation';
import type { ICameraPersistence } from './camera-store';

/**
 * File-backed camera persistence. Stores the camera map as JSON in the plugin's data directory
 * (app.getDataDirPath()), written with owner-only permissions. A missing or unreadable file is
 * treated as an empty set.
 */
export class FileCameraPersistence implements ICameraPersistence {
  private readonly file: string;

  constructor(dataDir: string, filename = 'cameras.json') {
    this.file = join(dataDir, filename);
  }

  load(): Record<string, ICamera> {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, ICamera>) : {};
    } catch {
      return {};
    }
  }

  save(cameras: Record<string, ICamera>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(cameras, null, 2), { mode: 0o600 });
  }
}
