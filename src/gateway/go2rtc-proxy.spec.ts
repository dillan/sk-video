import { describe, it, expect } from 'vitest';
import { go2rtcApiUrl } from './go2rtc-proxy';

describe('go2rtcApiUrl', () => {
  it('maps each transport to the loopback go2rtc API URL keyed by camera id', () => {
    expect(go2rtcApiUrl(1984, 'webrtc', 'foredeck')).toBe('http://127.0.0.1:1984/api/webrtc?src=foredeck');
    expect(go2rtcApiUrl(1984, 'hls', 'foredeck')).toBe('http://127.0.0.1:1984/api/stream.m3u8?src=foredeck');
    expect(go2rtcApiUrl(1984, 'frame', 'foredeck')).toBe('http://127.0.0.1:1984/api/frame.jpeg?src=foredeck');
    expect(go2rtcApiUrl(1984, 'mse', 'foredeck')).toBe('ws://127.0.0.1:1984/api/ws?src=foredeck');
  });

  it('always targets loopback regardless of port', () => {
    expect(go2rtcApiUrl(9999, 'webrtc', 'cam')).toBe('http://127.0.0.1:9999/api/webrtc?src=cam');
  });

  it('rejects an invalid camera id (no client-supplied src injection)', () => {
    expect(() => go2rtcApiUrl(1984, 'webrtc', '../evil')).toThrow();
    expect(() => go2rtcApiUrl(1984, 'webrtc', 'a b')).toThrow();
    expect(() => go2rtcApiUrl(1984, 'webrtc', '')).toThrow();
  });
});
