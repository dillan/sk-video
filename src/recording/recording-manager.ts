import {
  recordArgs,
  segmentsToPrune,
  type ISegment,
  type IRetentionLimits,
} from './recording-segments';

/**
 * Supervises per-camera DVR recorders: each is an ffmpeg process that remuxes go2rtc's loopback RTSP
 * restream into rotating MP4 segments. Recording is tier-gated (disabled on a fanless Cerbo-class
 * host) and channel-capped so a Pi can't be overwhelmed, and a periodic sweep prunes segments past
 * the byte/age budget so a full disk can't brick the server. The ffmpeg spawn is injected so the
 * orchestration is unit-testable.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface IRecorderProcess {
  stop(): void;
}

export type SpawnRecorder = (args: string[]) => IRecorderProcess;

export interface IRecordingManagerDeps {
  dir: string;
  /** go2rtc loopback RTSP base, e.g. 'rtsp://127.0.0.1:8554'. */
  rtspBase: () => string;
  spawnRecorder: SpawnRecorder;
  /** Max concurrent recording channels the tier allows (0 disables recording). */
  maxChannels: () => number;
  limits: () => IRetentionLimits;
  listSegments: () => ISegment[];
  removeFile: (path: string) => void;
  segmentSeconds?: number;
}

export class RecordingManager {
  constructor(private readonly deps: IRecordingManagerDeps) {
    void this.deps;
    void recordArgs;
    void segmentsToPrune;
  }

  /** Start recording a camera. Returns false if recording is disabled by tier or at the channel cap. */
  start(_cameraId: string): boolean {
    return false;
  }

  stop(_cameraId: string): void {
    // stub
  }

  stopAll(): void {
    // stub
  }

  isRecording(_cameraId: string): boolean {
    return false;
  }

  activeCameras(): string[] {
    return [];
  }

  /** Delete segments past the retention budget; returns how many were removed. */
  sweep(_now: number): number {
    return 0;
  }
}
