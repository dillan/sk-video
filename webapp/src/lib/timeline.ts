import type { IRecordingCameraTimeline } from '../api';

export interface ISpan {
  start: number;
  end: number;
  lengthMs: number;
}

/** The clock window a camera's track spans. */
export function cameraSpan(cam: IRecordingCameraTimeline): ISpan {
  const start = cam.startedAt;
  const end = Math.max(cam.endedAt, cam.startedAt);
  return { start, end, lengthMs: end - start };
}

export interface ILayoutBlock {
  kind: 'seg' | 'gap';
  leftPct: number;
  widthPct: number;
  seg?: IRecordingCameraTimeline['segments'][number];
  gap?: IRecordingCameraTimeline['gaps'][number];
}

/** Lay a camera's segments and gaps out as proportional blocks (% of the span) for the track. */
export function layoutBlocks(cam: IRecordingCameraTimeline): ILayoutBlock[] {
  const { start, lengthMs } = cameraSpan(cam);
  const pct = (ms: number): number => (lengthMs > 0 ? (ms / lengthMs) * 100 : 0);
  const blocks: ILayoutBlock[] = [
    ...cam.segments.map((seg): ILayoutBlock => ({
      kind: 'seg',
      leftPct: pct(seg.startedAt - start),
      widthPct: Math.max(pct(seg.durationMs), 0.5), // keep a sliver visible for tiny segments
      seg,
    })),
    ...cam.gaps.map((gap): ILayoutBlock => ({
      kind: 'gap',
      leftPct: pct(gap.startedAt - start),
      widthPct: pct(gap.endedAt - gap.startedAt),
      gap,
    })),
  ];
  return blocks.sort((a, b) => a.leftPct - b.leftPct);
}

/** Map a 0..1 click fraction across the track to a clock time, clamped into the span. */
export function fractionToTime(span: ISpan, fraction: number): number {
  const f = Math.min(Math.max(fraction, 0), 1);
  return Math.round(span.start + f * span.lengthMs);
}

/** Resolve a clock time to the segment that covers it and the in-segment seek offset (seconds). */
export function locateTime(
  cam: IRecordingCameraTimeline,
  t: number,
): { name: string; offsetSec: number } | null {
  for (const seg of cam.segments) {
    if (t >= seg.startedAt && t < seg.startedAt + seg.durationMs) {
      return { name: seg.name, offsetSec: (t - seg.startedAt) / 1000 };
    }
  }
  return null; // inside a coverage gap (or outside any segment)
}
