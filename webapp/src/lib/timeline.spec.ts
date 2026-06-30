import { describe, it, expect } from 'vitest';
import { cameraSpan, layoutBlocks, locateTime, fractionToTime } from './timeline';
import type { IRecordingCameraTimeline } from '../api';

const cam: IRecordingCameraTimeline = {
  camera: 'bow',
  recording: false,
  startedAt: 1000,
  endedAt: 2000,
  segments: [
    { name: 'a.mp4', startedAt: 1000, durationMs: 400, bytes: 10 },
    { name: 'b.mp4', startedAt: 1600, durationMs: 400, bytes: 10 },
  ],
  gaps: [{ startedAt: 1400, endedAt: 1600, durationMs: 200 }],
};

describe('timeline helpers', () => {
  it('cameraSpan returns the camera window and its length', () => {
    expect(cameraSpan(cam)).toEqual({ start: 1000, end: 2000, lengthMs: 1000 });
  });

  it('layoutBlocks places segments and gaps proportionally across the span', () => {
    const blocks = layoutBlocks(cam);
    const seg = blocks.find((b) => b.kind === 'seg' && b.seg?.name === 'a.mp4')!;
    expect(seg.leftPct).toBeCloseTo(0);
    expect(seg.widthPct).toBeCloseTo(40); // 400ms of a 1000ms span
    const gap = blocks.find((b) => b.kind === 'gap')!;
    expect(gap.leftPct).toBeCloseTo(40); // gap starts at 1400 → 40%
    expect(gap.widthPct).toBeCloseTo(20);
  });

  it('fractionToTime maps a 0..1 click position to a clock time in the span', () => {
    expect(fractionToTime(cameraSpan(cam), 0)).toBe(1000);
    expect(fractionToTime(cameraSpan(cam), 0.5)).toBe(1500);
    expect(fractionToTime(cameraSpan(cam), 1)).toBe(2000);
    expect(fractionToTime(cameraSpan(cam), 2)).toBe(2000); // clamped
  });

  it('locateTime resolves a time to its segment and seek offset', () => {
    expect(locateTime(cam, 1200)).toEqual({ name: 'a.mp4', offsetSec: 0.2 });
    expect(locateTime(cam, 1700)).toEqual({ name: 'b.mp4', offsetSec: 0.1 });
  });

  it('locateTime returns null inside a coverage gap', () => {
    expect(locateTime(cam, 1500)).toBeNull(); // 1500 is in the 1400–1600 gap
  });

  it('handles a zero-length span without dividing by zero', () => {
    const flat = { ...cam, startedAt: 1000, endedAt: 1000 };
    expect(cameraSpan(flat).lengthMs).toBe(0);
    expect(() => layoutBlocks(flat)).not.toThrow();
  });
});
