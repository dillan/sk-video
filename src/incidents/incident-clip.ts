import type { ISegmentSelection } from './incident-window';
import type { IClipCoverage } from './incident-validation';

/**
 * Pure ffmpeg clip planning: turns a segment selection + the requested window into a concat-list body,
 * the structured argument vector, and an honest coverage record. No IO and no shell metacharacters —
 * the args are a structured vector and concat paths are single-quote escaped. Reuses the recorder's
 * stream-copy conventions but DROPS -rtsp_transport (the inputs are on-disk MP4s, not an RTSP source).
 */

export interface IClipPlan {
  inputs: string[];
  /** Seek into the concatenated timeline before cutting, in ms (0 when pre-roll fully covered). */
  ssMs: number;
  durationMs: number;
  coverage: IClipCoverage;
}

/** Build the honest clip plan: seek/duration clamped to what the segments actually cover. */
export function planClip(
  sel: ISegmentSelection,
  windowStartMs: number,
  windowEndMs: number,
): IClipPlan {
  const ssMs = Math.max(0, windowStartMs - sel.spanStartMs);
  const actualStartMs = Math.max(windowStartMs, sel.spanStartMs);
  const actualEndMs = Math.min(windowEndMs, sel.spanEndMs);
  const durationMs = Math.max(0, actualEndMs - actualStartMs);
  return {
    inputs: sel.segments.map((s) => s.path),
    ssMs,
    durationMs,
    coverage: {
      requestedStartMs: windowStartMs,
      requestedEndMs: windowEndMs,
      actualStartMs,
      actualEndMs,
      segmentCount: sel.segments.length,
      keyframeAligned: true,
      // Disclose a recorder-restart gap so the manifest never claims continuous footage it lacks.
      contiguous: sel.contiguous,
    },
  };
}

/** The ffmpeg concat demuxer list body. Single quotes in a path are escaped as the concat spec wants. */
export function concatListContent(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

function msToSec(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** The structured ffmpeg argument vector to cut the planned clip (stream copy, faststart). */
export function clipArgs(concatListPath: string, plan: IClipPlan, outPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-ss',
    msToSec(plan.ssMs),
    '-i',
    concatListPath,
    '-t',
    msToSec(plan.durationMs),
    '-c',
    'copy', // keyframe-granular stream copy — never re-encode
    '-movflags',
    '+faststart',
    '-y',
    outPath,
  ];
}
