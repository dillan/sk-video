import { describe, it, expect } from 'vitest';
import { buildRecordingTimeline } from './recording-timeline';
import type { ISegment } from './recording-segments';

const seg = (cameraId: string, startedAt: number, bytes = 1000): ISegment => ({
  cameraId,
  path: `/rec/${cameraId}_seg_${startedAt}.mp4`,
  startedAt,
  bytes,
});

const MIN = 60_000;

describe('buildRecordingTimeline', () => {
  it('groups segments per camera, chronologically, with the nominal segment duration', () => {
    const tl = buildRecordingTimeline([seg('bow', 2 * MIN), seg('bow', 0), seg('bow', MIN)], {
      now: 4 * MIN,
      activeCameras: [],
      segmentSeconds: 60,
    });
    expect(tl.cameras).toHaveLength(1);
    const bow = tl.cameras[0];
    expect(bow.camera).toBe('bow');
    expect(bow.recording).toBe(false);
    expect(bow.segments.map((s) => s.startedAt)).toEqual([0, MIN, 2 * MIN]); // sorted ascending
    expect(bow.segments.every((s) => s.durationMs === MIN)).toBe(true);
    expect(bow.startedAt).toBe(0);
    expect(bow.endedAt).toBe(3 * MIN); // last start + nominal duration
    expect(bow.gaps).toEqual([]);
    expect(tl.segmentSeconds).toBe(60);
  });

  it('caps a segment duration at the gap to the next segment and records the coverage gap', () => {
    // Two contiguous minutes, a four-minute outage, then recording resumes and is still active.
    const tl = buildRecordingTimeline([seg('aft', 0), seg('aft', MIN), seg('aft', 5 * MIN)], {
      now: 5 * MIN + 30_000,
      activeCameras: ['aft'],
      segmentSeconds: 60,
    });
    const aft = tl.cameras[0];
    expect(aft.recording).toBe(true);
    expect(aft.gaps).toEqual([{ startedAt: 2 * MIN, endedAt: 5 * MIN, durationMs: 3 * MIN }]);
    // The last segment is still being written, so its duration grows up to (now - start), capped at nominal.
    expect(aft.segments[2].durationMs).toBe(30_000);
    expect(aft.endedAt).toBe(5 * MIN + 30_000);
  });

  it('exposes the Range-playable segment name for each segment', () => {
    const tl = buildRecordingTimeline([seg('bow', 0)], {
      now: MIN,
      activeCameras: [],
      segmentSeconds: 60,
    });
    expect(tl.cameras[0].segments[0].name).toBe('bow_seg_0.mp4');
  });

  it('returns no cameras for an empty index', () => {
    const tl = buildRecordingTimeline([], { now: 0, activeCameras: [], segmentSeconds: 60 });
    expect(tl.cameras).toEqual([]);
  });

  it('sorts cameras by name for a stable contract', () => {
    const tl = buildRecordingTimeline([seg('zulu', 0), seg('alpha', 0)], {
      now: MIN,
      activeCameras: [],
      segmentSeconds: 60,
    });
    expect(tl.cameras.map((c) => c.camera)).toEqual(['alpha', 'zulu']);
  });
});
