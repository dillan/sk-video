import { describe, it, expect } from 'vitest';
import { buildGo2rtcConfig, DEFAULT_GO2RTC_PORTS } from './go2rtc-config';
import type { ICamera } from '../cameras/camera-validation';

const foredeck: ICamera = { name: 'Foredeck', enabled: true, source: { scheme: 'rtsp', host: 'cam1', port: 554, path: '/s' } };
const aft: ICamera = { name: 'Aft', enabled: false, source: { scheme: 'rtsp', host: 'cam2' } };

describe('buildGo2rtcConfig', () => {
  it('binds the API and RTSP server to loopback', () => {
    const cfg = buildGo2rtcConfig({ cameras: {}, credentials: {}, ports: DEFAULT_GO2RTC_PORTS });
    expect((cfg.api as { listen: string }).listen).toBe('127.0.0.1:1984');
    expect((cfg.rtsp as { listen: string }).listen).toBe('127.0.0.1:8554');
    expect((cfg.webrtc as { listen: string }).listen).toBe(':8555'); // routable for ICE
  });

  it('maps enabled cameras to streams keyed by id, with embedded credentials', () => {
    const cfg = buildGo2rtcConfig({
      cameras: { foredeck },
      credentials: { foredeck: { username: 'u', password: 'p' } }
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
});
