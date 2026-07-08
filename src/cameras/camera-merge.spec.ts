import { describe, it, expect } from 'vitest';
import { mergeDiscovered, isStableSerial } from './camera-merge';
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

  it('preserves operator-declared sensors and geolocation across a rescan (never ONVIF-discovered)', () => {
    const withSensorsGeo: ICamera = {
      ...existing,
      capabilities: { ptz: true, sensors: ['bearing'] },
      geolocation: { latitude: 37.8, longitude: -122.4, orientationDeg: 180 },
    };
    const m = mergeDiscovered(withSensorsGeo, fresh);
    // capabilities are rebuilt from the probe, but the operator's sensor declaration must survive it.
    expect(m.capabilities?.sensors).toEqual(['bearing']);
    // geolocation is top-level and operator-set — it rides through untouched.
    expect(m.geolocation).toEqual({ latitude: 37.8, longitude: -122.4, orientationDeg: 180 });
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

describe('isStableSerial (camera identity hygiene)', () => {
  it('rejects IP-shaped and empty serials — an address is not an identity', () => {
    expect(isStableSerial('192.168.1.50')).toBe(false);
    expect(isStableSerial('')).toBe(false);
    expect(isStableSerial('   ')).toBe(false);
    expect(isStableSerial('fe80::abcd:1')).toBe(false);
  });

  it('keeps real serials and MAC addresses (both durable)', () => {
    expect(isStableSerial('QSX1234567890')).toBe(true);
    expect(isStableSerial('aa:bb:cc:dd:ee:ff')).toBe(true);
    expect(isStableSerial('0000-1111-2222')).toBe(true);
  });
});
