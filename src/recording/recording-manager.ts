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
  log?: (msg: string) => void;
}

export class RecordingManager {
  private readonly active = new Map<string, IRecorderProcess>();
  private readonly segmentSeconds: number;

  constructor(private readonly deps: IRecordingManagerDeps) {
    this.segmentSeconds = deps.segmentSeconds ?? 60;
  }

  /** Start recording a camera. Returns false if recording is disabled by tier or at the channel cap. */
  start(cameraId: string): boolean {
    if (this.active.has(cameraId)) {
      return true;
    }
    const max = this.deps.maxChannels();
    if (max <= 0 || this.active.size >= max) {
      return false;
    }
    const url = `${this.deps.rtspBase()}/${cameraId}`;
    const proc = this.deps.spawnRecorder(
      recordArgs(url, this.deps.dir, cameraId, this.segmentSeconds),
    );
    this.active.set(cameraId, proc);
    return true;
  }

  stop(cameraId: string): void {
    const proc = this.active.get(cameraId);
    if (proc) {
      proc.stop();
      this.active.delete(cameraId);
    }
  }

  stopAll(): void {
    for (const id of [...this.active.keys()]) {
      this.stop(id);
    }
  }

  isRecording(cameraId: string): boolean {
    return this.active.has(cameraId);
  }

  activeCameras(): string[] {
    return [...this.active.keys()];
  }

  /** The nominal length the recorder targets per MP4 segment, in seconds (for the timeline contract). */
  segmentLengthSeconds(): number {
    return this.segmentSeconds;
  }

  /** Delete segments past the retention budget; returns how many were removed. */
  sweep(now: number): number {
    const prune = segmentsToPrune(this.deps.listSegments(), this.deps.limits(), now);
    let removed = 0;
    for (const segment of prune) {
      try {
        // Per-segment guard: one un-deletable (locked / permission-denied) file must not abort the
        // loop and permanently halt ALL pruning, letting recordings grow past the budget and fill disk.
        this.deps.removeFile(segment.path);
        removed += 1;
      } catch (err) {
        this.deps.log?.(
          `failed to prune a recording segment: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return removed;
  }
}
