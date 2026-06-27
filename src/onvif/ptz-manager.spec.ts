import { describe, it, expect, vi } from 'vitest';
import { PtzManager, CameraNotFoundError, type IPtzManagerDeps } from './ptz-manager';
import type { ICamera } from '../cameras/camera-validation';
import { OnvifPtzController, type IOnvifCam } from './onvif-controller';

const camera: ICamera = {
  name: 'PTZ',
  enabled: true,
  source: { scheme: 'onvif', host: '192.168.1.60', port: 8000 },
};

function fakeCam(): IOnvifCam {
  return {
    continuousMove: (_o, cb) => cb(null),
    stop: (_o, cb) => cb(null),
    getPresets: (cb) => cb(null, {}),
    gotoPreset: (_o, cb) => cb(null),
    absoluteMove: (_o, cb) => cb(null),
    relativeMove: (_o, cb) => cb(null),
    getStatus: (_o, cb) => cb(null, { position: { x: 0, y: 0, zoom: 0 } }),
    getImagingSettings: (_o, cb) => cb(null, { irCutFilter: 'AUTO' }),
    setImagingSettings: (_o, cb) => cb(null),
    getStreamUri: (_o, cb) => cb(null, { uri: 'rtsp://cam/stream' }),
    getSnapshotUri: (_o, cb) => cb(null, { uri: 'http://cam/snap.jpg' }),
    getDeviceInformation: (cb) =>
      cb(null, {
        manufacturer: 'Acme',
        model: 'X',
        firmwareVersion: '1',
        serialNumber: 'S',
        hardwareId: 'H',
      }),
    getAudioOutputs: (cb) => cb(null, []),
  };
}

function makeDeps(overrides: Partial<IPtzManagerDeps> = {}): IPtzManagerDeps {
  return {
    getCamera: () => camera,
    getCredentials: () => ({ username: 'u', password: 'p' }),
    assertHostAllowed: async () => undefined,
    connectFactory: () => async () => fakeCam(),
    ...overrides,
  };
}

describe('PtzManager', () => {
  it('creates a controller for a known camera and caches it', async () => {
    const getCamera = vi.fn(() => camera);
    const assertHostAllowed = vi.fn(async () => undefined);
    const connectFactory = vi.fn(() => async () => fakeCam());
    const mgr = new PtzManager(makeDeps({ getCamera, assertHostAllowed, connectFactory }));

    const a = await mgr.controllerFor('cam');
    const b = await mgr.controllerFor('cam');
    expect(a).toBe(b);
    expect(connectFactory).toHaveBeenCalledTimes(1);
    expect(assertHostAllowed).toHaveBeenCalledTimes(1);
  });

  it('threads the camera allowSelfSigned opt-in into the connect target', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    const mgr = new PtzManager(
      makeDeps({ getCamera: () => ({ ...camera, allowSelfSigned: true }), connectFactory }),
    );
    await mgr.controllerFor('cam');
    expect(connectFactory).toHaveBeenCalledWith(expect.objectContaining({ allowSelfSigned: true }));
  });

  it('throws CameraNotFoundError for an unknown camera', async () => {
    const mgr = new PtzManager(makeDeps({ getCamera: () => null }));
    await expect(mgr.controllerFor('nope')).rejects.toBeInstanceOf(CameraNotFoundError);
  });

  it('propagates an SSRF rejection and does not cache a controller', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    const mgr = new PtzManager(
      makeDeps({
        assertHostAllowed: async () => {
          throw new Error('blocked host');
        },
        connectFactory,
      }),
    );
    await expect(mgr.controllerFor('cam')).rejects.toThrow(/blocked/);
    expect(connectFactory).not.toHaveBeenCalled();
  });

  it('probes capabilities once, caches them, and re-probes after invalidate', async () => {
    const probe = vi.spyOn(OnvifPtzController.prototype, 'probeCapabilities');
    const mgr = new PtzManager(makeDeps());
    const a = await mgr.capabilitiesFor('cam');
    const b = await mgr.capabilitiesFor('cam');
    expect(a).toBe(b); // same cached object, probed once
    expect(probe).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ absolutePtz: true, snapshotUri: 'http://cam/snap.jpg' });

    mgr.invalidate('cam');
    await mgr.capabilitiesFor('cam');
    expect(probe).toHaveBeenCalledTimes(2);
    probe.mockRestore();
  });

  it('invalidate forgets the cached controller', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    const mgr = new PtzManager(makeDeps({ connectFactory }));
    await mgr.controllerFor('cam');
    mgr.invalidate('cam');
    await mgr.controllerFor('cam');
    expect(connectFactory).toHaveBeenCalledTimes(2);
  });

  it('disposeAll disposes every cached controller and clears the cache', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    const mgr = new PtzManager(makeDeps({ connectFactory }));

    const a = await mgr.controllerFor('cam-a');
    const b = await mgr.controllerFor('cam-b');
    expect(a).not.toBe(b);
    expect(connectFactory).toHaveBeenCalledTimes(2);

    const disposeA = vi.spyOn(a, 'dispose');
    const disposeB = vi.spyOn(b, 'dispose');

    mgr.disposeAll();

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);

    // Cache was cleared, so the next request rebuilds a brand-new controller.
    const rebuilt = await mgr.controllerFor('cam-a');
    expect(rebuilt).not.toBe(a);
    expect(connectFactory).toHaveBeenCalledTimes(3);
  });
});
