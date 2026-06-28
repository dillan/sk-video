import type { IImagingSettings, IImagingUpdate } from './onvif-controller';

/**
 * Marine imaging presets built from the ONVIF controls onvif@0.8.1 actually exposes — IR-cut filter
 * mode plus brightness/contrast/saturation/sharpness. There is NO WDR or defog in this library, so
 * Fog/Glare are honest best-effort contrast/brightness nudges, not see-through-fog magic. Each preset
 * is applied ONLY to the levers a camera reports, computed RELATIVE TO A BASELINE reading
 * (multiplicative, so a 0-1 vs 0-100 scale is handled without assuming a range — the camera clamps
 * out-of-range writes). Because the factor is applied to a FIXED baseline (the camera's settings the
 * first time a preset was used, held by the route) rather than the live value, re-applying a preset
 * is idempotent — it never compounds — and Auto/Day restore the baseline tone. Pure maths, no camera
 * coupling.
 */

export const IMAGING_PRESETS = ['auto', 'day', 'night', 'fog', 'glare'] as const;
export type TImagingPreset = (typeof IMAGING_PRESETS)[number];

const NUMERIC_FIELDS = ['brightness', 'contrast', 'colorSaturation', 'sharpness'] as const;
type TNumericField = (typeof NUMERIC_FIELDS)[number];

interface IPresetSpec {
  /** IR-cut filter mode — the one well-defined lever; the primary day/night control. */
  irCut?: 'AUTO' | 'ON' | 'OFF';
  /** Multiplicative nudges on the current numeric value, applied only where the control exists. */
  factors?: Partial<Record<TNumericField, number>>;
}

// A factor of 1 writes the baseline value back, so Auto/Day are a true reset of the tone levers.
const RESTORE = { brightness: 1, contrast: 1, colorSaturation: 1, sharpness: 1 } as const;

const PRESET_SPECS: Record<TImagingPreset, IPresetSpec> = {
  // Hand IR control back to the camera's own day/night logic and restore the baseline tone levers.
  auto: { irCut: 'AUTO', factors: { ...RESTORE } },
  // Cut IR for true daylight colour and restore the baseline tone levers.
  day: { irCut: 'ON', factors: { ...RESTORE } },
  // Let IR through for low light, brighten, and desaturate (IR imagery is near-monochrome).
  night: { irCut: 'OFF', factors: { brightness: 1.25, colorSaturation: 0.7 } },
  // Best-effort haze: lift contrast + sharpness, ease saturation. Cannot see through dense fog.
  fog: { irCut: 'ON', factors: { contrast: 1.2, sharpness: 1.2, colorSaturation: 0.85 } },
  // Best-effort glare/backlight: knock down brightness, lift contrast. No WDR to truly compensate.
  glare: { irCut: 'ON', factors: { brightness: 0.8, contrast: 1.15 } },
};

export function isImagingPreset(value: unknown): value is TImagingPreset {
  return typeof value === 'string' && (IMAGING_PRESETS as readonly string[]).includes(value);
}

/** The imaging control names a camera exposes, derived from a current settings reading. */
export function availableControls(current: IImagingSettings): string[] {
  const out: string[] = [];
  if (current.irCutFilter !== undefined) {
    out.push('irCut');
  }
  for (const field of NUMERIC_FIELDS) {
    if (typeof current[field] === 'number') {
      out.push(field);
    }
  }
  return out;
}

/**
 * The imaging write to apply `preset`, gated to the controls present in `baseline` and computed by
 * multiplying the BASELINE value (not the live one) by the preset's factor — so re-applying a preset
 * never compounds. Returns only the fields it sets; `{}` means the camera exposes none of this
 * preset's levers.
 */
export function computeImagingUpdate(
  preset: TImagingPreset,
  baseline: IImagingSettings,
): IImagingUpdate {
  const spec = PRESET_SPECS[preset];
  const out: IImagingUpdate = {};
  if (spec.irCut && baseline.irCutFilter !== undefined) {
    out.irCutFilter = spec.irCut;
  }
  for (const field of NUMERIC_FIELDS) {
    const factor = spec.factors?.[field];
    const value = baseline[field];
    if (factor !== undefined && typeof value === 'number') {
      out[field] = Math.max(0, value * factor);
    }
  }
  return out;
}

/** True when the camera exposes at least one of this preset's levers (else the endpoint 409s). */
export function presetCapable(preset: TImagingPreset, baseline: IImagingSettings): boolean {
  return Object.keys(computeImagingUpdate(preset, baseline)).length > 0;
}

/** Which presets this camera can actually act on, given a settings reading. */
export function capablePresets(settings: IImagingSettings): TImagingPreset[] {
  return IMAGING_PRESETS.filter((p) => presetCapable(p, settings));
}
