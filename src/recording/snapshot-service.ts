import { randomUUID } from 'node:crypto';
import type { ISelfReading, ISelfState } from '../signalk/sk-bridge';
import { sniffImageType } from '../uploads/video-sniff';

/**
 * Captures a still frame from a camera and stamps it with the boat's telemetry at the moment of
 * capture, then stores it. This is the README's long-promised position-stamped snapshot and the
 * capture primitive the anchor-watch, MOB and incident features reuse. It reads vessel state through
 * the Signal K bridge, so the stamp is honest about missing/stale data (no fabricated position).
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
  contentType: string;
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
  private readonly idGen: () => string;
  private readonly now: () => number;

  constructor(private readonly options: ISnapshotServiceOptions) {
    this.idGen = options.idGen ?? (() => randomUUID());
    this.now = options.now ?? (() => Date.now());
  }

  /** Capture, telemetry-stamp and store a snapshot for `cameraId`; returns its metadata. */
  async capture(cameraId: string): Promise<ISnapshotMetadata> {
    const bytes = await this.options.capture(cameraId);
    const sniff = sniffImageType(bytes);
    if (!sniff) {
      throw new SnapshotRejectedError('captured frame is not a recognised image');
    }
    const meta: ISnapshotMetadata = {
      id: this.idGen(),
      cameraId,
      createdAt: this.now(),
      contentType: sniff.contentType,
      size: bytes.length,
      telemetry: toTelemetry(this.options.selfSource.getSelfState()),
    };
    this.options.store.save(bytes, meta);
    return meta;
  }
}

/** Flattens a bridge self-state snapshot into the stamp, tracking the oldest reading age used. */
export function toTelemetry(s: ISelfState): ISnapshotTelemetry {
  const ages: number[] = [];
  const val = <T>(r: ISelfReading<T>): T | null => {
    if (r.ageMs !== undefined) {
      ages.push(r.ageMs);
    }
    return r.value;
  };
  return {
    position: val(s.position),
    headingTrue: val(s.headingTrue),
    speedOverGround: val(s.speedOverGround),
    courseOverGroundTrue: val(s.courseOverGroundTrue),
    depth: val(s.depth),
    windSpeedApparent: val(s.wind.speedApparent),
    windAngleApparent: val(s.wind.angleApparent),
    oldestReadingAgeMs: ages.length > 0 ? Math.max(...ages) : null,
    positionAvailable: s.position.value !== null,
  };
}
