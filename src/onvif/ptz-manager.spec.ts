import { describe, it, expect, vi } from 'vitest';
import { PtzManager, CameraNotFoundError, type IPtzManagerDeps } from './ptz-manager';
import type { ICamera } from '../cameras/camera-validation';
import type { IOnvifCam } from './onvif-controller';

const camera: ICamera = { name: 'PTZ', enabled: true, source: { scheme: 'onvif', host: '192.168.1.60', port: 8000 } };

function fakeCam(): IOnvifCam {
  return {
    continuousMove: (_o, cb) => cb(null),
    stop: (_o, cb) => cb(null),
    getPresets: (cb) => cb(null, {}),
    gotoPreset: (_o, cb) => cb(null)
  };
}

function makeDeps(overrides: Partial<IPtzManagerDeps> = {}): IPtzManagerDeps {
  return {
    getCamera: () => camera,
    getCredentials: () => ({ username: 'u', password: 'p' }),
    assertHostAllowed: async () => undefined,
    connectFactory: () => async () => fakeCam(),
    ...overrides
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

  it('throws CameraNotFoundError for an unknown camera', async () => {
    const mgr = new PtzManager(makeDeps({ getCamera: () => null }));
    await expect(mgr.controllerFor('nope')).rejects.toBeInstanceOf(CameraNotFoundError);
  });

  it('propagates an SSRF rejection and does not cache a controller', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    const mgr = new PtzManager(makeDeps({
      assertHostAllowed: async () => { throw new Error('blocked host'); },
      connectFactory
    }));
    await expect(mgr.controllerFor('cam')).rejects.toThrow(/blocked/);
    expect(connectFactory).not.toHaveBeenCalled();
  });

  it('invalidate forgets the cached controller', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    const mgr = new PtzManager(makeDeps({ connectFactory }));
    await mgr.controllerFor('cam');
    mgr.invalidate('cam');
    await mgr.controllerFor('cam');
    expect(connectFactory).toHaveBeenCalledTimes(2);
  });
});
