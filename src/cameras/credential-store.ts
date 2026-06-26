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
  private credentials: Record<string, ICameraCredentials> = {};

  constructor(private readonly persistence: ICredentialPersistence) {
    void persistence;
    // RED stub.
  }

  get(id: string): ICameraCredentials | null {
    void id;
    // RED stub.
    return null;
  }

  /** All credentials, for building the go2rtc config. */
  all(): Record<string, ICameraCredentials> {
    // RED stub.
    return {};
  }

  /** Validates id + credential shape and upserts; throws on invalid input. */
  set(id: string, credentials: unknown): void {
    void id;
    void credentials;
    // RED stub.
    throw new Error('not implemented');
  }

  delete(id: string): boolean {
    void id;
    // RED stub.
    return false;
  }
}
