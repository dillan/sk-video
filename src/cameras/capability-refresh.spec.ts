import { describe, it, expect, vi } from 'vitest';
import { refreshChangedCameras, type ICapabilityRefreshDeps } from './capability-refresh';
import type { ICamera } from './camera-validation';
import type { IIntrospectResult } from '../onvif/onvif-introspect';

const camera = (firmware?: string): ICamera => ({
  name: 'Cam',
  enabled: true,
  source: { scheme: 'rtsp', host: 'h' },
  capabilities: { ptz: true },
  ...(firmware ? { device: { firmware } } : {}),
});

const RESULT: IIntrospectResult = {
  ptz: true,
  absolutePtz: true,
  imaging: true,
  imagingControls: ['irCut'],
  audio: true,
  audioBackchannel: false,
  spotlight: false,
  alarm: false,
  firmwareVersion: 'v2',
};

function setup(
  cams: Array<[string, ICamera]>,
  firmwareByProbe: Record<string, string | undefined>,
) {
  const introspect = vi.fn().mockResolvedValue(RESULT);
  const save = vi.fn().mockResolvedValue(undefined);
  const deps: ICapabilityRefreshDeps = {
    cameras: () => cams,
    probeFirmware: (id) => Promise.resolve(firmwareByProbe[id]),
    introspect,
    save,
    log: () => undefined,
  };
  return { deps, introspect, save };
}

describe('refreshChangedCameras', () => {
  it('re-scans when the firmware changed', async () => {
    const { deps, introspect, save } = setup([['cam', camera('v1')]], { cam: 'v2' });
    const r = await refreshChangedCameras(deps);
    expect(r.rescanned).toEqual(['cam']);
    expect(introspect).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      'cam',
      expect.objectContaining({ device: { firmware: 'v2' } }),
    );
  });

  it('backfills when no firmware was ever recorded (first run after the feature ships)', async () => {
    const { deps, save } = setup([['cam', camera(undefined)]], { cam: 'v2' });
    const r = await refreshChangedCameras(deps);
    expect(r.rescanned).toEqual(['cam']);
    expect(save).toHaveBeenCalled();
  });

  it('does nothing when the firmware is unchanged', async () => {
    const { deps, introspect, save } = setup([['cam', camera('v2')]], { cam: 'v2' });
    const r = await refreshChangedCameras(deps);
    expect(r.rescanned).toEqual([]);
    expect(introspect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('skips a camera whose firmware could not be read (offline / no ONVIF)', async () => {
    const { deps, introspect } = setup([['cam', camera('v1')]], { cam: undefined });
    const r = await refreshChangedCameras(deps);
    expect(r.rescanned).toEqual([]);
    expect(introspect).not.toHaveBeenCalled();
  });

  it('is best-effort: one camera failing does not stop the others', async () => {
    const introspect = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(RESULT);
    const save = vi.fn().mockResolvedValue(undefined);
    const deps: ICapabilityRefreshDeps = {
      cameras: () => [
        ['a', camera('v1')],
        ['b', camera('v1')],
      ],
      probeFirmware: () => Promise.resolve('v2'),
      introspect,
      save,
      log: () => undefined,
    };
    const r = await refreshChangedCameras(deps);
    expect(r.checked).toBe(2);
    expect(r.rescanned).toEqual(['b']);
  });
});
