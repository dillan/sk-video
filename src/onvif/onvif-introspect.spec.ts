import { describe, it, expect, vi } from 'vitest';
import { introspectOnvifCamera, type IIntrospectDeps } from './onvif-introspect';
import type { IOnvifCam } from './onvif-controller';

/** A fake ONVIF cam exposing just what probeCapabilities drives, with per-feature toggles. */
function fakeCam(over: Partial<Record<string, unknown>> = {}): IOnvifCam {
  const o = {
    streamUri: 'rtsp://192.168.1.50:554/Streaming/Channels/101',
    snapshotUri: 'http://192.168.1.50/snap.jpg',
    failStatus: false,
    ...over,
  } as { streamUri: string; snapshotUri: string; failStatus: boolean };
  return {
    continuousMove: (_o, cb) => cb(null),
    stop: (_o, cb) => cb(null),
    getPresets: (cb) => cb(null, {}),
    gotoPreset: (_o, cb) => cb(null),
    absoluteMove: (_o, cb) => cb(null),
    relativeMove: (_o, cb) => cb(null),
    getStatus: (_o, cb) =>
      o.failStatus ? cb(new Error('no ptz')) : cb(null, { position: { x: 0, y: 0, zoom: 0 } }),
    getImagingSettings: (_o, cb) => cb(null, { irCutFilter: 'AUTO', brightness: 50 }),
    setImagingSettings: (_o, cb) => cb(null),
    getStreamUri: (_o, cb) => cb(null, { uri: o.streamUri }),
    getSnapshotUri: (_o, cb) => cb(null, { uri: o.snapshotUri }),
    getDeviceInformation: (cb) =>
      cb(null, {
        manufacturer: 'Acme',
        model: 'Dome 2MP',
        firmwareVersion: '1.0',
        serialNumber: 'SN123',
        hardwareId: 'HW1',
      }),
    getAudioOutputs: (cb) => cb(null, [{ token: 'AO1' }]),
  };
}

function deps(over: Partial<IIntrospectDeps> = {}): IIntrospectDeps {
  return {
    assertHostAllowed: async () => undefined,
    connectFactory: () => async () => fakeCam(),
    ...over,
  };
}

describe('introspectOnvifCamera', () => {
  it('auto-fills the source, snapshot, identity and capabilities from a healthy camera', async () => {
    const result = await introspectOnvifCamera({ host: '192.168.1.50', port: 8000 }, deps());
    expect(result).toMatchObject({
      manufacturer: 'Acme',
      model: 'Dome 2MP',
      serialNumber: 'SN123',
      snapshotUri: 'http://192.168.1.50/snap.jpg',
      source: { scheme: 'rtsp', host: '192.168.1.50', port: 554, path: '/Streaming/Channels/101' },
      absolutePtz: true,
      imaging: true,
      audio: true,
    });
    expect(result.imagingControls).toContain('irCut');
  });

  it('SSRF-checks the device host before connecting and rejects a blocked host', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    await expect(
      introspectOnvifCamera(
        { host: '169.254.169.254' },
        deps({
          assertHostAllowed: async (h) => {
            if (h === '169.254.169.254') throw new Error('blocked host');
          },
          connectFactory,
        }),
      ),
    ).rejects.toThrow(/blocked/);
    expect(connectFactory).not.toHaveBeenCalled();
  });

  it('drops the auto-filled source when the camera returns a stream URI on a forbidden host', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({
        connectFactory: () => async () => fakeCam({ streamUri: 'rtsp://169.254.169.254:554/evil' }),
        assertHostAllowed: async (h) => {
          if (h === '169.254.169.254') throw new Error('blocked stream host');
        },
      }),
    );
    expect(result.source).toBeUndefined(); // the rest still came through
    expect(result.snapshotUri).toBe('http://192.168.1.50/snap.jpg');
  });

  it('omits the source for a non-allow-listed stream scheme', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({ connectFactory: () => async () => fakeCam({ streamUri: 'ftp://192.168.1.50/x' }) }),
    );
    expect(result.source).toBeUndefined();
  });

  it('reports no PTZ when status is unavailable on a fixed camera', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({ connectFactory: () => async () => fakeCam({ failStatus: true }) }),
    );
    expect(result.absolutePtz).toBe(false);
    expect(result.ptz).toBe(false);
  });
});
