import { describe, it, expect } from 'vitest';
import { mergeDiscovered } from './camera-merge';
import type { ICamera } from './camera-validation';
import type { IIntrospectResult } from '../onvif/onvif-introspect';

const existing: ICamera = {
  name: 'My Foredeck',
  enabled: true,
  source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/main' },
  role: 'security',
  placement: { mount: 'mast', bearingRelativeDeg: 90 },
  calibration: { pan: { offset: 0, scalePerDeg: 0.01 } },
  safetyCritical: true,
  capabilities: { ptz: true }, // stale
  media: { codec: 'h264', projection: 'equirectangular' },
};

const fresh: IIntrospectResult = {
  ptz: true,
  absolutePtz: true,
  imaging: true,
  imagingControls: ['irCut', 'brightness'],
  audio: true,
  audioBackchannel: true,
  spotlight: true,
  alarm: true,
  auxCommands: ['tt:WhiteLight', 'tt:Siren'],
  firmwareVersion: 'v4.0.0',
  manufacturer: 'REOLINK',
  serialNumber: 'ABC',
};

describe('mergeDiscovered', () => {
  it('refreshes discovered capabilities + device and records firmware', () => {
    const m = mergeDiscovered(existing, fresh);
    expect(m.capabilities).toMatchObject({
      spotlight: true,
      alarm: true,
      imaging: ['irCut', 'brightness'],
    });
    expect(m.device).toMatchObject({ manufacturer: 'REOLINK', serial: 'ABC', firmware: 'v4.0.0' });
  });

  it('preserves operator-set fields (name, role, placement, calibration, safety, source, projection)', () => {
    const m = mergeDiscovered(existing, fresh);
    expect(m.name).toBe('My Foredeck');
    expect(m.role).toBe('security');
    expect(m.placement).toEqual({ mount: 'mast', bearingRelativeDeg: 90 });
    expect(m.calibration).toEqual({ pan: { offset: 0, scalePerDeg: 0.01 } });
    expect(m.safetyCritical).toBe(true);
    expect(m.source).toEqual(existing.source);
    expect(m.media?.projection).toBe('equirectangular');
  });

  it('adopts a safe substream + codec but drops an unsafe substream path', () => {
    const ok = mergeDiscovered(existing, {
      ...fresh,
      codec: 'h265',
      substreamPath: '/Preview_01_sub',
      substreams: true,
    });
    expect(ok.capabilities?.substreams).toBe(true);
    expect(ok.media).toMatchObject({ codec: 'h265', substreamPath: '/Preview_01_sub' });

    const bad = mergeDiscovered(existing, {
      ...fresh,
      substreamPath: '/sub?token=x',
      substreams: true,
    });
    expect(bad.capabilities?.substreams).toBe(false);
    expect(bad.media?.substreamPath).toBeUndefined();
  });
});
