import { isValidCameraId } from './camera-store';
import type { ICameraCredentials } from '../gateway/go2rtc-source';

/** Pluggable persistence for camera credentials (kept separate from the public camera resource). */
export interface ICredentialPersistence {
  load(): Record<string, ICameraCredentials>;
  save(credentials: Record<string, ICameraCredentials>): void;
}

/**
 * Server-side store for camera credentials, keyed by camera id. Credentials are never part of the
 * `cameras` resource and are only read internally (to build go2rtc sources). Never round-tripped to
 * clients.
 */
export class CredentialStore {
  private credentials: Record<string, ICameraCredentials>;

  constructor(private readonly persistence: ICredentialPersistence) {
    this.credentials = { ...persistence.load() };
  }

  get(id: string): ICameraCredentials | null {
    return this.credentials[id] ?? null;
  }

  /** All credentials, for building the go2rtc config. */
  all(): Record<string, ICameraCredentials> {
    return { ...this.credentials };
  }

  /** Validates id + credential shape and upserts; throws on invalid input. */
  set(id: string, credentials: unknown): void {
    if (!isValidCameraId(id)) {
      throw new Error(`invalid camera id: ${id}`);
    }
    if (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials)) {
      throw new Error('credentials must be an object');
    }
    const c = credentials as Record<string, unknown>;
    if (c.username !== undefined && typeof c.username !== 'string') {
      throw new Error('username must be a string');
    }
    if (c.password !== undefined && typeof c.password !== 'string') {
      throw new Error('password must be a string');
    }
    const clean: ICameraCredentials = {};
    if (typeof c.username === 'string') clean.username = c.username;
    if (typeof c.password === 'string') clean.password = c.password;
    this.credentials[id] = clean;
    this.persistence.save({ ...this.credentials });
  }

  delete(id: string): boolean {
    if (!(id in this.credentials)) {
      return false;
    }
    delete this.credentials[id];
    this.persistence.save({ ...this.credentials });
    return true;
  }
}
