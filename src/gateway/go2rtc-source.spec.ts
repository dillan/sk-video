import { describe, it, expect } from 'vitest';
import { buildGo2rtcSource } from './go2rtc-source';
import type { ICamera } from '../cameras/camera-validation';

function cam(source: ICamera['source']): ICamera {
  return { name: 'c', enabled: true, source };
}

describe('buildGo2rtcSource', () => {
  it('builds an RTSP URL without credentials', () => {
    expect(
      buildGo2rtcSource(cam({ scheme: 'rtsp', host: 'cam.local', port: 554, path: '/stream1' })),
    ).toBe('rtsp://cam.local:554/stream1');
  });

  it('injects URL-encoded credentials', () => {
    expect(
      buildGo2rtcSource(cam({ scheme: 'rtsp', host: 'cam.local', port: 554, path: '/s' }), {
        username: 'admin',
        password: 'p@ss/w:rd',
      }),
    ).toBe('rtsp://admin:p%40ss%2Fw%3Ard@cam.local:554/s');
  });

  it('omits the port and path when absent', () => {
    expect(
      buildGo2rtcSource(cam({ scheme: 'onvif', host: '192.168.1.50' }), {
        username: 'u',
        password: 'p',
      }),
    ).toBe('onvif://u:p@192.168.1.50');
  });

  it('supports an empty password with a username', () => {
    expect(
      buildGo2rtcSource(cam({ scheme: 'rtsp', host: 'h' }), { username: 'u', password: '' }),
    ).toBe('rtsp://u:@h');
  });

  it('ignores credentials when no username is given', () => {
    expect(
      buildGo2rtcSource(cam({ scheme: 'http', host: 'h', port: 8080, path: '/mjpeg' }), {
        password: 'p',
      }),
    ).toBe('http://h:8080/mjpeg');
  });
});
