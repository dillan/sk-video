import { describe, it, expect } from 'vitest';
import { buildGo2rtcConfig, DEFAULT_GO2RTC_PORTS } from './go2rtc-config';
import type { ICamera } from '../cameras/camera-validation';

const foredeck: ICamera = {
  name: 'Foredeck',
  enabled: true,
  source: { scheme: 'rtsp', host: 'cam1', port: 554, path: '/s' },
};
const aft: ICamera = { name: 'Aft', enabled: false, source: { scheme: 'rtsp', host: 'cam2' } };

describe('buildGo2rtcConfig', () => {
  it('binds the API and RTSP server to loopback', () => {
    const cfg = buildGo2rtcConfig({ cameras: {}, credentials: {}, ports: DEFAULT_GO2RTC_PORTS });
    expect((cfg.api as { listen: string }).listen).toBe('127.0.0.1:1984');
    expect((cfg.rtsp as { listen: string }).listen).toBe('127.0.0.1:8554');
    expect((cfg.webrtc as { listen: string }).listen).toBe(':8555'); // routable for ICE
    expect(cfg.webrtc).not.toHaveProperty('candidates'); // auto-detect by default
  });

  it('advertises explicit WebRTC candidates when given (NAT / container / multi-homed hosts)', () => {
    const cfg = buildGo2rtcConfig({
      cameras: {},
      credentials: {},
      webrtcCandidates: ['127.0.0.1:8555', ' ', 'stun:8555'],
    });
    // Blanks are dropped; the rest are advertised as ICE host candidates.
    expect((cfg.webrtc as { candidates: string[] }).candidates).toEqual([
      '127.0.0.1:8555',
      'stun:8555',
    ]);
  });

  it('maps enabled cameras to streams keyed by id, with embedded credentials', () => {
    const cfg = buildGo2rtcConfig({
      cameras: { foredeck },
      credentials: { foredeck: { username: 'u', password: 'p' } },
    });
    expect(cfg.streams).toEqual({ foredeck: 'rtsp://u:p@cam1:554/s' });
  });

  it('excludes disabled cameras from the streams', () => {
    const cfg = buildGo2rtcConfig({ cameras: { foredeck, aft }, credentials: {} });
    expect(Object.keys(cfg.streams as object)).toEqual(['foredeck']);
  });

  it('produces an empty streams map when there are no enabled cameras', () => {
    const cfg = buildGo2rtcConfig({ cameras: { aft }, credentials: {} });
    expect(cfg.streams).toEqual({});
  });

  it('emits a failover source array + a _sub variant when the camera has a substream', () => {
    const withSub: ICamera = { ...foredeck, media: { substreamPath: '/sub' } };
    const cfg = buildGo2rtcConfig({
      cameras: { foredeck: withSub },
      credentials: { foredeck: { username: 'u', password: 'p' } },
    });
    expect(cfg.streams).toEqual({
      foredeck: ['rtsp://u:p@cam1:554/s', 'rtsp://u:p@cam1:554/sub'], // main, then sub (failover)
      foredeck_sub: 'rtsp://u:p@cam1:554/sub', // explicit low-res variant, credentials server-side
    });
  });

  describe('hardware acceleration (opt-in)', () => {
    const h265NoSub: ICamera = { ...foredeck, media: { codec: 'h265' } };

    it('adds a GPU H.264 transcode source for an H.265 camera with no sub-stream when enabled', () => {
      const cfg = buildGo2rtcConfig({
        cameras: { foredeck: h265NoSub },
        credentials: { foredeck: { username: 'u', password: 'p' } },
        hardwareAcceleration: true,
      });
      // The raw H.265 main stays (HLS/passthrough); go2rtc serves the hardware-transcoded H.264 source
      // to a WebRTC client. `#hardware` (bare) lets go2rtc auto-detect the engine.
      expect(cfg.streams).toEqual({
        foredeck: ['rtsp://u:p@cam1:554/s', 'ffmpeg:rtsp://u:p@cam1:554/s#video=h264#hardware'],
      });
    });

    it('does nothing when hardware acceleration is off (the default) — plain H.265 source', () => {
      const cfg = buildGo2rtcConfig({
        cameras: { foredeck: h265NoSub },
        credentials: { foredeck: { username: 'u', password: 'p' } },
      });
      expect(cfg.streams).toEqual({ foredeck: 'rtsp://u:p@cam1:554/s' });
    });

    it('leaves an H.265 camera that already has an H.264 sub-stream alone (no transcode needed)', () => {
      const withSub: ICamera = { ...foredeck, media: { codec: 'h265', substreamPath: '/sub' } };
      const cfg = buildGo2rtcConfig({
        cameras: { foredeck: withSub },
        credentials: { foredeck: { username: 'u', password: 'p' } },
        hardwareAcceleration: true,
      });
      expect(cfg.streams).toEqual({
        foredeck: ['rtsp://u:p@cam1:554/s', 'rtsp://u:p@cam1:554/sub'],
        foredeck_sub: 'rtsp://u:p@cam1:554/sub',
      });
    });

    it('does not transcode a plain H.264 camera even when acceleration is on (already playable)', () => {
      const h264: ICamera = { ...foredeck, media: { codec: 'h264' } };
      const cfg = buildGo2rtcConfig({
        cameras: { foredeck: h264 },
        credentials: {},
        hardwareAcceleration: true,
      });
      expect(cfg.streams).toEqual({ foredeck: 'rtsp://cam1:554/s' });
    });
  });
});
