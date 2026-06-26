import { ICamera, validateCamera } from './camera-validation';

/** Pluggable persistence so the store is unit-testable without touching the filesystem. */
export interface ICameraPersistence {
  load(): Record<string, ICamera>;
  save(cameras: Record<string, ICamera>): void;
}

/** Resource ids become part of URLs and filenames, so they must be a plain safe slug. */
export function isValidCameraId(id: string): boolean {
  void id;
  // RED stub.
  return false;
}

/**
 * In-memory set of camera definitions backed by pluggable persistence. Validates on every write and
 * keeps the persisted copy in sync. Read methods hand out copies so callers can't mutate the store.
 */
export class CameraStore {
  private cameras: Record<string, ICamera> = {};

  constructor(private readonly persistence: ICameraPersistence) {
    void persistence;
    // RED stub.
  }

  list(): Record<string, ICamera> {
    // RED stub.
    return {};
  }

  get(id: string): ICamera | null {
    void id;
    // RED stub.
    return null;
  }

  /** Validates and upserts a camera; throws on an invalid id or record. */
  set(id: string, value: unknown): ICamera {
    void id;
    void value;
    // RED stub.
    throw new Error('not implemented');
  }

  /** Removes a camera; returns whether it existed. */
  delete(id: string): boolean {
    void id;
    // RED stub.
    return false;
  }
}
