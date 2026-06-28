import { describe, it, expect, vi } from 'vitest';
import { ImagingPresetApplier } from './imaging-apply';
import type { IImagingSettings } from './onvif-controller';

const DAYLIGHT: IImagingSettings = { irCutFilter: 'AUTO', brightness: 50 };

describe('ImagingPresetApplier', () => {
  it('applies the night preset against the captured baseline and returns the update', async () => {
    const setImaging = vi.fn().mockResolvedValue(undefined);
    const applier = new ImagingPresetApplier({
      getImaging: vi.fn().mockResolvedValue(DAYLIGHT),
      setImaging,
    });
    const update = await applier.apply('cam1', 'night');
    expect(update).not.toBeNull();
    expect(setImaging).toHaveBeenCalledWith('cam1', update);
    // The night preset turns the IR-cut filter off so the sensor sees IR.
    expect((update as { irCutFilter?: string }).irCutFilter).toBe('OFF');
  });

  it('is idempotent: re-applying computes against the same baseline, not the nudged value', async () => {
    const getImaging = vi
      .fn()
      .mockResolvedValueOnce(DAYLIGHT)
      .mockResolvedValueOnce({ irCutFilter: 'OFF', brightness: 62 }); // camera now reflects the first apply
    const applier = new ImagingPresetApplier({
      getImaging,
      setImaging: vi.fn().mockResolvedValue(undefined),
    });
    const first = await applier.apply('cam1', 'night');
    const second = await applier.apply('cam1', 'night');
    expect(second).toEqual(first); // baseline captured once → no compounding
  });

  it('returns null (and never writes) when the camera exposes none of the levers', async () => {
    const setImaging = vi.fn();
    const applier = new ImagingPresetApplier({
      getImaging: vi.fn().mockResolvedValue({}), // no irCut, no tone controls
      setImaging,
    });
    expect(await applier.apply('cam1', 'night')).toBeNull();
    expect(setImaging).not.toHaveBeenCalled();
  });
});
