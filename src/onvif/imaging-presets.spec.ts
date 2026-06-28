import { describe, it, expect } from 'vitest';
import {
  isImagingPreset,
  availableControls,
  computeImagingUpdate,
  presetCapable,
  capablePresets,
} from './imaging-presets';
import type { IImagingSettings } from './onvif-controller';

const full: IImagingSettings = {
  brightness: 50,
  contrast: 40,
  colorSaturation: 60,
  sharpness: 30,
  irCutFilter: 'AUTO',
};

describe('isImagingPreset', () => {
  it('accepts known presets and rejects others', () => {
    expect(isImagingPreset('night')).toBe(true);
    expect(isImagingPreset('disco')).toBe(false);
    expect(isImagingPreset(5)).toBe(false);
  });
});

describe('availableControls', () => {
  it('lists only the controls present in the reading', () => {
    expect(availableControls(full).sort()).toEqual(
      ['brightness', 'colorSaturation', 'contrast', 'irCut', 'sharpness'].sort(),
    );
    expect(availableControls({ irCutFilter: 'ON' })).toEqual(['irCut']);
    expect(availableControls({})).toEqual([]);
  });
});

describe('computeImagingUpdate', () => {
  it('day/auto set only the IR-cut mode and touch no numeric levers', () => {
    expect(computeImagingUpdate('day', full)).toEqual({ irCutFilter: 'ON' });
    expect(computeImagingUpdate('auto', full)).toEqual({ irCutFilter: 'AUTO' });
  });

  it('night turns IR-cut off and scales brightness up + saturation down, relative to current', () => {
    const u = computeImagingUpdate('night', full);
    expect(u.irCutFilter).toBe('OFF');
    expect(u.brightness).toBeCloseTo(50 * 1.25, 5);
    expect(u.colorSaturation).toBeCloseTo(60 * 0.7, 5);
    expect(u.contrast).toBeUndefined(); // night doesn't touch contrast
  });

  it('is scale-independent: the same factors apply on a 0-1 ranged camera', () => {
    const u = computeImagingUpdate('night', {
      brightness: 0.5,
      colorSaturation: 0.6,
      irCutFilter: 'AUTO',
    });
    expect(u.brightness).toBeCloseTo(0.625, 5);
    expect(u.colorSaturation).toBeCloseTo(0.42, 5);
  });

  it('only sets levers the camera reports', () => {
    // A camera that exposes only the IR-cut filter: fog can still set IR mode, no numeric writes.
    expect(computeImagingUpdate('fog', { irCutFilter: 'AUTO' })).toEqual({ irCutFilter: 'ON' });
    // A camera with no exposed controls at all: nothing to apply.
    expect(computeImagingUpdate('night', {})).toEqual({});
  });

  it('never drives a value below zero', () => {
    const u = computeImagingUpdate('glare', { brightness: 0, contrast: 10 });
    expect(u.brightness).toBe(0);
  });
});

describe('presetCapable / capablePresets', () => {
  it('a numeric-only preset is incapable on an IR-cut-only camera, but day/auto/fog/glare still are', () => {
    const irOnly: IImagingSettings = { irCutFilter: 'AUTO' };
    expect(presetCapable('day', irOnly)).toBe(true);
    expect(presetCapable('night', irOnly)).toBe(true); // night also flips IR-cut
    expect(capablePresets(irOnly)).toEqual(['auto', 'day', 'night', 'fog', 'glare']);
  });

  it('a camera exposing no controls is incapable of every preset', () => {
    expect(capablePresets({})).toEqual([]);
    expect(presetCapable('day', {})).toBe(false);
  });
});
