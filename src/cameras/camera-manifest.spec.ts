import { describe, it, expect } from 'vitest';
import { buildCameraManifest, type ICameraManifest } from './camera-manifest';
import type { ICamera } from './camera-validation';

const PTZ_CAM: ICamera = {
  name: 'Bow Camera',
  enabled: true,
  source: { scheme: 'rtsp', host: '10.0.0.2', path: '/main' },
  role: 'navigation',
  capabilities: {
    ptz: true,
    absolutePtz: true,
    spotlight: true,
    substreams: true,
    audio: true,
    imaging: ['brightness', 'contrast'],
  },
  media: { codec: 'h265', substreamPath: '/sub' },
  device: { manufacturer: 'Acme', model: 'SeaCam 3', serial: 'SC3-1', firmware: '1.2.3' },
};

const FIXED_CAM: ICamera = {
  name: 'Engine Bay',
  enabled: true,
  source: { scheme: 'rtsp', host: '10.0.0.3', path: '/main' },
};

describe('buildCameraManifest', () => {
  const manifest = buildCameraManifest('bow', PTZ_CAM, { recordingAvailable: true });
  const fixed = buildCameraManifest('engine', FIXED_CAM, { recordingAvailable: false });

  it('declares supported features from the stored capabilities (radar supportedFeatures idiom)', () => {
    expect(manifest.supportedFeatures).toEqual(
      expect.arrayContaining(['ptz', 'absolutePtz', 'spotlight', 'substreams', 'audio', 'imaging']),
    );
    expect(manifest.supportedFeatures).toContain('recording');
    expect(fixed.supportedFeatures).not.toContain('ptz');
    expect(fixed.supportedFeatures).not.toContain('recording');
  });

  it('advertises each declared sensor as its own feature (sensor:<type>)', () => {
    const withSensor = buildCameraManifest(
      'compass',
      { ...FIXED_CAM, capabilities: { sensors: ['bearing'] } },
      { recordingAvailable: false },
    );
    expect(withSensor.supportedFeatures).toContain('sensor:bearing');
    // A camera with no declared sensors advertises none.
    expect(fixed.supportedFeatures.some((f) => f.startsWith('sensor:'))).toBe(false);
  });

  it('describes the device as read-only characteristics', () => {
    expect(manifest.characteristics).toMatchObject({
      make: 'Acme',
      model: 'SeaCam 3',
      firmware: '1.2.3',
      codec: 'h265',
    });
  });

  it('publishes credential-free relative stream URLs (same-origin proxy, radar streamUrl idiom)', () => {
    expect(manifest.streams).toEqual({
      webrtc: '/plugins/sk-video/cameras/bow/whep',
      hls: '/plugins/sk-video/cameras/bow/stream.m3u8',
      mjpeg: '/plugins/sk-video/cameras/bow/frame.jpeg',
    });
  });

  it('derives typed controls with availability from ONE capability source', () => {
    const byId = Object.fromEntries(manifest.controls.map((c) => [c.id, c]));
    expect(byId.spotlight).toMatchObject({
      dataType: 'boolean',
      category: 'base',
      available: true,
      putPath: 'cameras.bow.spotlight',
    });
    expect(byId.recording).toMatchObject({ dataType: 'boolean', available: true });
    expect(byId.activePreset).toMatchObject({
      dataType: 'string',
      putPath: 'cameras.bow.activePreset',
    });
    expect(byId.snapshot).toMatchObject({ dataType: 'button', available: true });
    // one number control per imaging capability, generically renderable
    expect(byId.brightness).toMatchObject({ dataType: 'number', category: 'base' });
    // a camera without the capability gets no such control at all
    const fixedIds = fixed.controls.map((c) => c.id);
    expect(fixedIds).not.toContain('spotlight');
    expect(fixedIds).not.toContain('activePreset');
    // recording exists but is honestly unavailable when the tier refuses channels
    expect(fixed.controls.find((c) => c.id === 'recording')?.available).toBe(false);
  });

  it('exposes read-only identity as info controls (radar isReadOnly idiom)', () => {
    const firmware = manifest.controls.find((c) => c.id === 'firmwareVersion');
    expect(firmware).toMatchObject({ category: 'info', isReadOnly: true, dataType: 'string' });
  });

  it('never leaks a network address', () => {
    for (const m of [manifest, fixed] as ICameraManifest[]) {
      expect(JSON.stringify(m)).not.toContain('10.0.0.');
    }
  });
});
