import { describe, it, expect } from 'vitest';
import { planClip, concatListContent, clipArgs } from './incident-clip';
import type { ISegmentSelection } from './incident-window';
import type { ISegment } from '../recording/recording-segments';

const seg = (path: string): ISegment => ({ cameraId: 'bow', path, startedAt: 0, bytes: 1 });
const selection = (spanStartMs: number, spanEndMs: number, paths: string[]): ISegmentSelection => ({
  segments: paths.map(seg),
  spanStartMs,
  spanEndMs,
  contiguous: true,
});

describe('planClip', () => {
  it('seeks into the span and reports exact coverage when fully covered', () => {
    const sel = selection(0, 180_000, ['/rec/a.mp4', '/rec/b.mp4', '/rec/c.mp4']);
    const plan = planClip(sel, 60_000, 120_000);
    expect(plan.ssMs).toBe(60_000);
    expect(plan.durationMs).toBe(60_000);
    expect(plan.inputs).toEqual(['/rec/a.mp4', '/rec/b.mp4', '/rec/c.mp4']);
    expect(plan.coverage).toMatchObject({
      requestedStartMs: 60_000,
      requestedEndMs: 120_000,
      actualStartMs: 60_000,
      actualEndMs: 120_000,
      segmentCount: 3,
      keyframeAligned: true,
    });
  });

  it('clamps ssMs to 0 and reports the shorter actual window when pre-roll is missing', () => {
    // window asks [−30s, +30s] but the span only starts at 0 and ends at +20s.
    const sel = selection(0, 20_000, ['/rec/a.mp4']);
    const plan = planClip(sel, -30_000, 30_000);
    expect(plan.ssMs).toBe(0);
    expect(plan.coverage.actualStartMs).toBe(0);
    expect(plan.coverage.actualEndMs).toBe(20_000);
    expect(plan.durationMs).toBe(20_000);
  });
});

describe('concatListContent', () => {
  it('emits file lines and escapes single quotes', () => {
    expect(concatListContent(['/rec/a.mp4', "/rec/o'brien.mp4"])).toBe(
      "file '/rec/a.mp4'\nfile '/rec/o'\\''brien.mp4'\n",
    );
  });
});

describe('clipArgs', () => {
  it('builds a stream-copy concat cut with NO -rtsp_transport and no shell metacharacters', () => {
    const plan = planClip(selection(0, 60_000, ['/rec/a.mp4']), 0, 30_000);
    const args = clipArgs('/tmp/list.txt', plan, '/out/clip.mp4');
    expect(args).toContain('-f');
    expect(args).toContain('concat');
    expect(args).toContain('-safe');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).toContain('+faststart');
    expect(args).not.toContain('-rtsp_transport');
    // structured args: no element smuggles a shell operator
    for (const a of args) {
      expect(a).not.toMatch(/[;&|`$<>]/);
    }
    expect(args[args.length - 1]).toBe('/out/clip.mp4');
  });
});
