import type { ISegment } from '../recording/recording-segments';

/**
 * Pure DVR-segment selection for a clip window. recording-segments.ts parses only the camera id from
 * a segment filename; this recovers each segment's TRUE wall-clock start from the strftime stamp so a
 * clip can be cut for an arbitrary [start, end] window. The local-time(filename) vs UTC(mtime)
 * ambiguity is isolated behind an injectable epoch builder so tests are deterministic with no hidden
 * timezone math.
 */

const SEGMENT_TS_RE = /^(.+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;

/** Adjacent segments closer than this are treated as contiguous (covers strftime rounding). */
const GAP_TOLERANCE_MS = 1500;

export interface ISegmentTimeParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Default epoch builder: LOCAL time, matching ffmpeg's `-strftime` on the same host. */
export function localEpoch(p: ISegmentTimeParts): number {
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s).getTime();
}

/** Recovers a segment's camera id and true start epoch from its filename, or null if it doesn't match. */
export function parseSegmentStart(
  filename: string,
  makeEpoch: (p: ISegmentTimeParts) => number = localEpoch,
): { cameraId: string; startMs: number } | null {
  const m = SEGMENT_TS_RE.exec(filename);
  if (!m) {
    return null;
  }
  const [, cameraId, y, mo, d, h, mi, s] = m;
  return {
    cameraId,
    startMs: makeEpoch({
      y: Number(y),
      mo: Number(mo),
      d: Number(d),
      h: Number(h),
      mi: Number(mi),
      s: Number(s),
    }),
  };
}

/**
 * A segment's [start, end] span. Uses the filename's strftime start when parseable (start..start+dur).
 * Otherwise falls back to the mtime, which sits at roughly the segment END for a closed file, so the
 * span is anchored backwards (mtime-dur..mtime).
 */
export function segmentSpan(
  seg: ISegment,
  segmentSeconds: number,
  makeEpoch: (p: ISegmentTimeParts) => number = localEpoch,
): { startMs: number; endMs: number } {
  const durMs = segmentSeconds * 1000;
  const base = filenameOf(seg.path);
  const parsed = parseSegmentStart(base, makeEpoch);
  if (parsed) {
    return { startMs: parsed.startMs, endMs: parsed.startMs + durMs };
  }
  return { startMs: seg.startedAt - durMs, endMs: seg.startedAt };
}

export interface ISegmentSelection {
  segments: ISegment[];
  spanStartMs: number;
  spanEndMs: number;
  /** False when the selected segments have a real gap (recorder restart) inside the span. */
  contiguous: boolean;
}

/**
 * The segments of one camera that overlap [windowStartMs, windowEndMs], ordered by start, with a
 * contiguity flag. Returns null when no segment overlaps the window.
 */
export function selectClipSegments(
  segments: ISegment[],
  cameraId: string,
  windowStartMs: number,
  windowEndMs: number,
  segmentSeconds: number,
  makeEpoch: (p: ISegmentTimeParts) => number = localEpoch,
): ISegmentSelection | null {
  const withSpan = segments
    .filter((seg) => seg.cameraId === cameraId)
    .map((seg) => ({ seg, span: segmentSpan(seg, segmentSeconds, makeEpoch) }))
    .filter(({ span }) => span.startMs < windowEndMs && span.endMs > windowStartMs)
    .sort((a, b) => a.span.startMs - b.span.startMs);

  if (withSpan.length === 0) {
    return null;
  }

  let contiguous = true;
  for (let i = 1; i < withSpan.length; i += 1) {
    if (withSpan[i].span.startMs - withSpan[i - 1].span.endMs > GAP_TOLERANCE_MS) {
      contiguous = false;
      break;
    }
  }

  return {
    segments: withSpan.map(({ seg }) => seg),
    spanStartMs: withSpan[0].span.startMs,
    spanEndMs: Math.max(...withSpan.map(({ span }) => span.endMs)),
    contiguous,
  };
}

function filenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
