import { describe, it, expect } from 'vitest';
import { recordArgs, parseSegmentName, segmentsToPrune, type ISegment } from './recording-segments';

describe('recordArgs', () => {
  it('builds stream-copy segmenting args targeting an strftime mp4 pattern (no shell)', () => {
    const args = recordArgs('rtsp://127.0.0.1:8554/bow', '/data/rec', 'bow', 60);
    expect(args).toContain('rtsp://127.0.0.1:8554/bow');
    expect(args).toContain('-c');
    expect(args).toContain('copy'); // never re-encode
    expect(args).toContain('-f');
    expect(args).toContain('segment');
    expect(args).toContain('60'); // segment_time
    expect(args[args.length - 1]).toBe('/data/rec/bow_%Y%m%d_%H%M%S.mp4');
    expect(args.some((a) => a.includes(';') || a.includes('|') || a.includes('&'))).toBe(false);
  });
});

describe('parseSegmentName', () => {
  it('extracts the camera id from a segment filename', () => {
    expect(parseSegmentName('bow_20260627_143000.mp4')).toEqual({ cameraId: 'bow' });
    expect(parseSegmentName('cam-1_20260101_000000.mp4')).toEqual({ cameraId: 'cam-1' });
  });

  it('returns null for anything that is not a segment', () => {
    expect(parseSegmentName('notes.txt')).toBeNull();
    expect(parseSegmentName('bow.mp4')).toBeNull();
    expect(parseSegmentName('bow_2026_143000.mp4')).toBeNull();
  });
});

describe('segmentsToPrune', () => {
  const seg = (cameraId: string, startedAt: number, bytes: number): ISegment => ({
    cameraId,
    path: `/r/${cameraId}-${startedAt}.mp4`,
    startedAt,
    bytes,
  });

  it('prunes segments older than the max age', () => {
    const now = 100_000;
    const segs = [seg('a', 10_000, 100), seg('a', 95_000, 100)];
    const prune = segmentsToPrune(segs, { maxBytes: 1_000_000, maxAgeMs: 50_000 }, now);
    expect(prune.map((s) => s.startedAt)).toEqual([10_000]); // the old one only
  });

  it('prunes the oldest segments first to fit the byte budget', () => {
    const now = 100_000;
    const segs = [seg('a', 1, 100), seg('a', 2, 100), seg('a', 3, 100)];
    const prune = segmentsToPrune(segs, { maxBytes: 250, maxAgeMs: 1e12 }, now);
    // total 300 > 250 → drop the oldest (100) → 200 <= 250.
    expect(prune.map((s) => s.startedAt)).toEqual([1]);
  });

  it('returns nothing when within both limits', () => {
    const segs = [seg('a', 1, 100)];
    expect(segmentsToPrune(segs, { maxBytes: 1000, maxAgeMs: 1e12 }, 100)).toEqual([]);
  });

  it('does not double-count a segment pruned for age toward the budget', () => {
    const now = 100_000;
    const segs = [seg('a', 1, 500), seg('a', 99_000, 100)]; // old big one + recent small one
    const prune = segmentsToPrune(segs, { maxBytes: 200, maxAgeMs: 50_000 }, now);
    // The old 500 is pruned for age; remaining 100 <= 200 → nothing else pruned.
    expect(prune.map((s) => s.startedAt)).toEqual([1]);
  });
});
