import { ICamera, validateCamera } from './camera-validation';

/** Pluggable persistence so the store is unit-testable without touching the filesystem. */
export interface ICameraPersistence {
  load(): Record<string, ICamera>;
  save(cameras: Record<string, ICamera>): void;
}

/** Resource ids become part of URLs and filenames, so they must be a plain safe slug. */
export function isValidCameraId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

/**
 * In-memory set of camera definitions backed by pluggable persistence. Validates on every write and
 * keeps the persisted copy in sync. Read methods hand out copies so callers can't mutate the store.
 */
export class CameraStore {
  private cameras: Record<string, ICamera>;

  constructor(private readonly persistence: ICameraPersistence) {
    this.cameras = { ...persistence.load() };
  }

  list(): Record<string, ICamera> {
    return { ...this.cameras };
  }

  get(id: string): ICamera | null {
    return this.cameras[id] ?? null;
  }

  /** Validates and upserts a camera; throws on an invalid id or record. */
  set(id: string, value: unknown): ICamera {
    if (!isValidCameraId(id)) {
      throw new Error(`invalid camera id: ${id}`);
    }
    const result = validateCamera(value);
    if (!result.valid || !result.value) {
      throw new Error(`invalid camera: ${result.errors.join('; ')}`);
    }
    this.cameras[id] = result.value;
    this.persistence.save({ ...this.cameras });
    return result.value;
  }

  /** Removes a camera; returns whether it existed. */
  delete(id: string): boolean {
    if (!(id in this.cameras)) {
      return false;
    }
    delete this.cameras[id];
    this.persistence.save({ ...this.cameras });
    return true;
  }
}
