import type { ISelfState } from '../signalk/sk-bridge';

/**
 * Captures a still frame from a camera and stamps it with the boat's telemetry at the moment of
 * capture, then stores it. This is the README's long-promised position-stamped snapshot and the
 * capture primitive the anchor-watch, MOB and incident features reuse. It reads vessel state through
 * the Signal K bridge, so the stamp is honest about missing/stale data (no fabricated position).
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface ISnapshotTelemetry {
  position: { latitude: number; longitude: number } | null;
  headingTrue: number | null;
  speedOverGround: number | null;
  courseOverGroundTrue: number | null;
  depth: number | null;
  windSpeedApparent: number | null;
  windAngleApparent: number | null;
  /** The oldest (largest) reading age in ms among the stamped readings, or null if unknown. */
  oldestReadingAgeMs: number | null;
  /** False when no position fix was available — the stamp says so rather than guessing. */
  positionAvailable: boolean;
}

export interface ISnapshotMetadata {
  id: string;
  cameraId: string;
  createdAt: number;
  contentType: 'image/jpeg';
  size: number;
  telemetry: ISnapshotTelemetry;
}

/** Persists a captured JPEG plus its telemetry sidecar. */
export interface ISnapshotStore {
  save(bytes: Uint8Array, meta: ISnapshotMetadata): void;
}

/** The slice of the Signal K bridge the snapshot service needs. */
export interface ISelfStateSource {
  getSelfState(): ISelfState;
}

export interface ISnapshotServiceOptions {
  /** Fetches a JPEG frame for a camera id (server-side, e.g. from go2rtc on loopback). */
  capture: (cameraId: string) => Promise<Uint8Array>;
  selfSource: ISelfStateSource;
  store: ISnapshotStore;
  idGen?: () => string;
  now?: () => number;
}

/** Thrown when the captured frame is not a valid image. */
export class SnapshotRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotRejectedError';
  }
}

export class SnapshotService {
  constructor(private readonly options: ISnapshotServiceOptions) {
    void this.options;
  }

  /** Capture, telemetry-stamp and store a snapshot for `cameraId`; returns its metadata. */
  async capture(cameraId: string): Promise<ISnapshotMetadata> {
    return {
      id: '',
      cameraId,
      createdAt: 0,
      contentType: 'image/jpeg',
      size: 0,
      telemetry: {
        position: null,
        headingTrue: null,
        speedOverGround: null,
        courseOverGroundTrue: null,
        depth: null,
        windSpeedApparent: null,
        windAngleApparent: null,
        oldestReadingAgeMs: null,
        positionAvailable: false,
      },
    };
  }
}
