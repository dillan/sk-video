import { describe, it, expect } from 'vitest';
import { transportHints } from './transport-hints';
import type { IStreamHealth } from './stream-health';

const health = (codecs: string[], online = true): IStreamHealth => ({
  online,
  producers: online ? 1 : 0,
  consumers: 0,
  codecs,
  sources: [],
});

describe('transportHints', () => {
  it('puts WebRTC first for an H.264 stream', () => {
    const h = transportHints(health(['H264', 'AAC']));
    expect(h.recommended).toEqual(['webrtc', 'hls', 'mjpeg']);
    expect(h.online).toBe(true);
    expect(h.codecs).toEqual(['H264', 'AAC']);
    expect(h.note).toMatch(/not an ABR ladder/i);
  });

  it('demotes WebRTC for an H.265 stream (spotty browser support)', () => {
    expect(transportHints(health(['H265'])).recommended).toEqual(['hls', 'mjpeg', 'webrtc']);
    expect(transportHints(health(['HEVC'])).recommended[0]).toBe('hls');
    expect(transportHints(health(['h.265'])).recommended[0]).toBe('hls');
  });

  it('still recommends the walk for an offline / codec-less stream', () => {
    const h = transportHints(health([], false));
    expect(h.online).toBe(false);
    expect(h.recommended).toEqual(['webrtc', 'hls', 'mjpeg']);
  });
});
