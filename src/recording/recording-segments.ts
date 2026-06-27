/**
 * Pure helpers for the DVR recorder: the ffmpeg arguments that copy a loopback RTSP restream into
 * rotating MP4 segments (no shell, structured args), the segment filename parser, and the byte+time
 * retention policy. Recording reads from go2rtc's own loopback RTSP — credentials live only in
 * go2rtc's in-memory source, never in a segment path.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface ISegment {
  cameraId: string;
  path: string;
  /** Epoch ms the segment began (the file's mtime). */
  startedAt: number;
  bytes: number;
}

export interface IRetentionLimits {
  /** Total bytes allowed across a camera's segments. */
  maxBytes: number;
  /** Segments older than this are pruned. */
  maxAgeMs: number;
}

/** ffmpeg arguments to remux a loopback RTSP stream into rotating MP4 segments (stream copy). */
export function recordArgs(
  _rtspUrl: string,
  _outDir: string,
  _cameraId: string,
  _segmentSeconds: number,
): string[] {
  return [];
}

/** Parses `<cameraId>_<YYYYMMDD>_<HHMMSS>.mp4`, returning the camera id, or null if it doesn't match. */
export function parseSegmentName(_filename: string): { cameraId: string } | null {
  return null;
}

/** Segments to delete to satisfy the byte+age limits (oldest first). */
export function segmentsToPrune(
  _segments: ISegment[],
  _limits: IRetentionLimits,
  _now: number,
): ISegment[] {
  return [];
}
