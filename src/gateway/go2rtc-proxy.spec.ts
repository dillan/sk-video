import { describe, it, expect } from 'vitest';
import { go2rtcApiUrl, go2rtcHlsUrl } from './go2rtc-proxy';

describe('go2rtcApiUrl', () => {
  it('maps each transport to the default go2rtc API URL keyed by camera id', () => {
    expect(go2rtcApiUrl(1984, 'webrtc', 'foredeck')).toBe(
      'http://127.0.0.1:1984/api/webrtc?src=foredeck',
    );
    expect(go2rtcApiUrl(1984, 'hls', 'foredeck')).toBe(
      'http://127.0.0.1:1984/api/stream.m3u8?src=foredeck',
    );
    expect(go2rtcApiUrl(1984, 'frame', 'foredeck')).toBe(
      'http://127.0.0.1:1984/api/frame.jpeg?src=foredeck',
    );
    expect(go2rtcApiUrl(1984, 'mse', 'foredeck')).toBe('ws://127.0.0.1:1984/api/ws?src=foredeck');
  });

  it('targets the default local host when given a port', () => {
    expect(go2rtcApiUrl(9999, 'webrtc', 'cam')).toBe('http://127.0.0.1:9999/api/webrtc?src=cam');
  });

  it('targets a supplied go2rtc base URL for container mode', () => {
    expect(go2rtcApiUrl('http://sk-video-gateway:1984/', 'webrtc', 'cam')).toBe(
      'http://sk-video-gateway:1984/api/webrtc?src=cam',
    );
    expect(go2rtcApiUrl('http://sk-video-gateway:1984', 'mse', 'cam')).toBe(
      'ws://sk-video-gateway:1984/api/ws?src=cam',
    );
  });

  it('rejects an invalid camera id (no client-supplied src injection)', () => {
    expect(() => go2rtcApiUrl(1984, 'webrtc', '../evil')).toThrow();
    expect(() => go2rtcApiUrl(1984, 'webrtc', 'a b')).toThrow();
    expect(() => go2rtcApiUrl(1984, 'webrtc', '')).toThrow();
  });
});

describe('go2rtcHlsUrl', () => {
  it('builds the default HLS sub-resource URL, preserving go2rtc query params', () => {
    expect(go2rtcHlsUrl(1984, 'foredeck', 'playlist.m3u8', 'id=abc')).toBe(
      'http://127.0.0.1:1984/api/hls/playlist.m3u8?id=abc',
    );
    expect(go2rtcHlsUrl(1984, 'foredeck', 'segment.ts', 'id=abc&n=5')).toBe(
      'http://127.0.0.1:1984/api/hls/segment.ts?id=abc&n=5',
    );
    expect(go2rtcHlsUrl(1984, 'foredeck', 'init.mp4', '')).toBe(
      'http://127.0.0.1:1984/api/hls/init.mp4',
    );
  });

  it('strips a client-supplied src param', () => {
    expect(go2rtcHlsUrl(1984, 'foredeck', 'segment.ts', 'src=evil&id=abc')).toBe(
      'http://127.0.0.1:1984/api/hls/segment.ts?id=abc',
    );
  });

  it('targets a supplied go2rtc base URL for container mode', () => {
    expect(go2rtcHlsUrl('http://sk-video-gateway:1984/', 'foredeck', 'segment.ts', 'n=5')).toBe(
      'http://sk-video-gateway:1984/api/hls/segment.ts?n=5',
    );
  });

  it('rejects an invalid id or resource (no traversal)', () => {
    expect(() => go2rtcHlsUrl(1984, '../x', 'playlist.m3u8')).toThrow();
    expect(() => go2rtcHlsUrl(1984, 'cam', '../config')).toThrow();
    expect(() => go2rtcHlsUrl(1984, 'cam', 'a/b')).toThrow();
  });
});
