import { describe, it, expect } from 'vitest';
import { parseSegmentStart, segmentSpan, selectClipSegments } from './incident-window';
import type { ISegment } from '../recording/recording-segments';

// Deterministic epoch builder: treat the parts as if UTC, so tests don't depend on the host TZ.
const utc = (p: { y: number; mo: number; d: number; h: number; mi: number; s: number }): number =>
  Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);

const SEG_SECONDS = 60;
const T0 = utc({ y: 2026, mo: 6, d: 27, h: 14, mi: 30, s: 0 });

function seg(cameraId: string, name: string, bytes = 1000, startedAt = T0): ISegment {
  return { cameraId, path: `/rec/${name}`, startedAt, bytes };
}

describe('parseSegmentStart', () => {
  it('recovers camera id + start epoch, tolerating underscores in the id', () => {
    const r = parseSegmentStart('bow_cam_20260627_143000.mp4', utc);
    expect(r).toEqual({ cameraId: 'bow_cam', startMs: T0 });
  });

  it('returns null for a non-segment name', () => {
    expect(parseSegmentStart('notes.txt', utc)).toBeNull();
    expect(parseSegmentStart('bow.mp4', utc)).toBeNull();
  });
});

describe('segmentSpan', () => {
  it('uses the filename start when parseable', () => {
    expect(segmentSpan(seg('bow', 'bow_20260627_143000.mp4'), SEG_SECONDS, utc)).toEqual({
      startMs: T0,
      endMs: T0 + 60_000,
    });
  });

  it('falls back to mtime-anchored span when the name is not a segment', () => {
    const s = seg('bow', 'weird.mp4', 1000, T0 + 60_000);
    expect(segmentSpan(s, SEG_SECONDS, utc)).toEqual({ startMs: T0, endMs: T0 + 60_000 });
  });
});

describe('selectClipSegments', () => {
  const segments = [
    seg('bow', 'bow_20260627_142900.mp4'), // [T0-60s, T0]
    seg('bow', 'bow_20260627_143000.mp4'), // [T0, T0+60s]
    seg('bow', 'bow_20260627_143100.mp4'), // [T0+60s, T0+120s]
    seg('stern', 'stern_20260627_143000.mp4'),
  ];

  it('returns only the bow segments overlapping the window, ordered by start', () => {
    const sel = selectClipSegments(segments, 'bow', T0 - 10_000, T0 + 70_000, SEG_SECONDS, utc);
    expect(sel).not.toBeNull();
    expect(sel!.segments.map((s) => s.path)).toEqual([
      '/rec/bow_20260627_142900.mp4',
      '/rec/bow_20260627_143000.mp4',
      '/rec/bow_20260627_143100.mp4',
    ]);
    expect(sel!.spanStartMs).toBe(T0 - 60_000);
    expect(sel!.spanEndMs).toBe(T0 + 120_000);
    expect(sel!.contiguous).toBe(true);
  });

  it('returns null when no segment overlaps', () => {
    expect(
      selectClipSegments(segments, 'bow', T0 + 600_000, T0 + 660_000, SEG_SECONDS, utc),
    ).toBeNull();
  });

  it('flags a recorder-restart gap as non-contiguous', () => {
    const gapped = [
      seg('bow', 'bow_20260627_143000.mp4'), // [T0, T0+60s]
      seg('bow', 'bow_20260627_143300.mp4'), // [T0+180s, T0+240s] — 120s gap
    ];
    const sel = selectClipSegments(gapped, 'bow', T0, T0 + 240_000, SEG_SECONDS, utc);
    expect(sel!.contiguous).toBe(false);
  });
});
