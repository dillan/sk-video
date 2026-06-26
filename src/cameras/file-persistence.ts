import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ICamera } from './camera-validation';
import type { ICameraPersistence } from './camera-store';
import type { ICredentialPersistence } from './credential-store';
import type { ICameraCredentials } from '../gateway/go2rtc-source';

/** Reads a JSON object from a file, treating a missing/unreadable file as empty. */
function readJsonObject<T>(file: string): Record<string, T> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, T>)
      : {};
  } catch {
    return {};
  }
}

/** Writes a JSON object to a file with owner-only permissions. */
function writeJsonObject(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

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
    return readJsonObject<ICamera>(this.file);
  }

  save(cameras: Record<string, ICamera>): void {
    writeJsonObject(this.file, cameras);
  }
}

/**
 * File-backed credential persistence. Stored separately from the camera definitions, owner-only, and
 * never served through the cameras resource.
 */
export class FileCredentialPersistence implements ICredentialPersistence {
  private readonly file: string;

  constructor(dataDir: string, filename = 'credentials.json') {
    this.file = join(dataDir, filename);
  }

  load(): Record<string, ICameraCredentials> {
    return readJsonObject<ICameraCredentials>(this.file);
  }

  save(credentials: Record<string, ICameraCredentials>): void {
    writeJsonObject(this.file, credentials);
  }
}
