import { describe, it, expect } from 'vitest';
import {
  pickTransport,
  nextTransport,
  transportLabel,
  ptzDelayed,
  isHevc,
  transportsForVariant,
  codecLabel,
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
