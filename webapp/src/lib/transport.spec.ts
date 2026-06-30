import { describe, it, expect } from 'vitest';
import {
  pickTransport,
  nextTransport,
  transportLabel,
  ptzDelayed,
  isHevc,
  transportsForVariant,
  codecLabel,
  trackStall,
  H264_TRANSPORTS,
} from './transport';

describe('transport walk', () => {
  it('picks the first recommended rung (and defaults to mjpeg when empty)', () => {
    expect(pickTransport(['webrtc', 'hls', 'mjpeg'])).toBe('webrtc');
    expect(pickTransport([])).toBe('mjpeg');
  });
  it('falls back down the walk and stops at the end', () => {
    const walk = ['webrtc', 'hls', 'mjpeg'] as const;
    expect(nextTransport([...walk], 'webrtc')).toBe('hls');
    expect(nextTransport([...walk], 'hls')).toBe('mjpeg');
    expect(nextTransport([...walk], 'mjpeg')).toBeNull();
  });
  it('labels rungs and flags delayed PTZ on the still-refresh rung', () => {
    expect(transportLabel('webrtc')).toBe('WebRTC');
    expect(transportLabel('mjpeg')).toMatch(/still-refresh/);
    expect(ptzDelayed('mjpeg')).toBe(true);
    expect(ptzDelayed('webrtc')).toBe(false);
  });
});

describe('codec helpers + variant walk', () => {
  it('detects HEVC/H.265 codec names', () => {
    expect(isHevc(['H265'])).toBe(true);
    expect(isHevc(['hevc', 'PCMA'])).toBe(true);
    expect(isHevc(['H264'])).toBe(false);
  });

  it('uses the WebRTC-first H.264 walk for the sub, the server order otherwise', () => {
    // The server order for an H.265 main is HLS-first; playing the H.264 sub must NOT inherit that.
    expect(transportsForVariant(true, ['hls', 'mjpeg', 'webrtc'])).toEqual(H264_TRANSPORTS);
    expect(H264_TRANSPORTS[0]).toBe('webrtc');
    expect(transportsForVariant(false, ['hls', 'mjpeg', 'webrtc'])).toEqual([
      'hls',
      'mjpeg',
      'webrtc',
    ]);
  });

  it('formats codec ids for display', () => {
    expect(codecLabel('h265')).toBe('H.265');
    expect(codecLabel('h264')).toBe('H.264');
    expect(codecLabel('mjpeg')).toBe('MJPEG');
    expect(codecLabel('mpeg4')).toBe('MPEG4');
  });
});

describe('trackStall (stall watchdog)', () => {
  it('resets the sample and is not stalled while playback advances', () => {
    const r = trackStall({ time: 1, at: 1000 }, 1.5, 3000, 6000);
    expect(r.stalled).toBe(false);
    expect(r.sample).toEqual({ time: 1.5, at: 3000 });
  });

  it('keeps the sample and stays patient before the timeout elapses', () => {
    const r = trackStall({ time: 2, at: 1000 }, 2, 5000, 6000); // no progress, only 4s in
    expect(r.stalled).toBe(false);
    expect(r.sample).toEqual({ time: 2, at: 1000 });
  });

  it('flags a stall once playback has not advanced for the timeout', () => {
    const r = trackStall({ time: 2, at: 1000 }, 2, 7000, 6000); // frozen for 6s
    expect(r.stalled).toBe(true);
  });

  it('flags a feed that never started (time stuck at 0) past the timeout', () => {
    expect(trackStall({ time: 0, at: 0 }, 0, 6000, 6000).stalled).toBe(true);
  });
});
