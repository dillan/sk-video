import { join } from 'node:path';

/**
 * Pure helpers for the DVR recorder: the ffmpeg arguments that copy a loopback RTSP restream into
 * rotating MP4 segments (no shell, structured args), the segment filename parser, and the byte+time
 * retention policy. Recording reads from go2rtc's own loopback RTSP — credentials live only in
 * go2rtc's in-memory source, never in a segment path.
 */

const SEGMENT_RE = /^(.+)_\d{8}_\d{6}\.mp4$/;

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
  rtspUrl: string,
  outDir: string,
  cameraId: string,
  segmentSeconds: number,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-rtsp_transport',
    'tcp',
    '-i',
    rtspUrl,
    '-c',
    'copy', // remux only — never burn CPU re-encoding
    '-f',
    'segment',
    '-segment_time',
    String(segmentSeconds),
    '-segment_format',
    'mp4',
    '-reset_timestamps',
    '1',
    '-strftime',
    '1',
    join(outDir, `${cameraId}_%Y%m%d_%H%M%S.mp4`),
  ];
}

/** Parses `<cameraId>_<YYYYMMDD>_<HHMMSS>.mp4`, returning the camera id, or null if it doesn't match. */
export function parseSegmentName(filename: string): { cameraId: string } | null {
  const match = SEGMENT_RE.exec(filename);
  return match ? { cameraId: match[1] } : null;
}

/** Segments to delete to satisfy the byte+age limits (oldest first). */
export function segmentsToPrune(
  segments: ISegment[],
  limits: IRetentionLimits,
  now: number,
): ISegment[] {
  const oldestFirst = [...segments].sort((a, b) => a.startedAt - b.startedAt);
  const prune = new Set<ISegment>();

  for (const segment of oldestFirst) {
    if (now - segment.startedAt > limits.maxAgeMs) {
      prune.add(segment);
    }
  }

  let total = 0;
  for (const segment of oldestFirst) {
    if (!prune.has(segment)) {
      total += segment.bytes;
    }
  }
  for (const segment of oldestFirst) {
    if (total <= limits.maxBytes) {
      break;
    }
    if (prune.has(segment)) {
      continue;
    }
    prune.add(segment);
    total -= segment.bytes;
  }

  return [...prune];
}
