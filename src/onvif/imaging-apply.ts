import type { IImagingSettings, IImagingUpdate } from './onvif-controller';
import { computeImagingUpdate, type TImagingPreset } from './imaging-presets';

/**
 * Applies an imaging preset to a camera, holding the per-camera session baseline so re-applying is
 * idempotent (every preset is computed against the FIRST reading, never a nudged value). This is the
 * same baseline-relative logic the imaging route uses, factored out so the automatic low-light apply
 * (MOB / anchor-watch after dusk) shares it instead of duplicating the maths. The ONVIF get/set are
 * injected, so it is unit-testable without a camera.
 */

export interface IImagingApplyDeps {
  getImaging: (id: string) => Promise<IImagingSettings>;
  setImaging: (id: string, update: IImagingUpdate) => Promise<void>;
}

export class ImagingPresetApplier {
  private readonly baselines = new Map<string, IImagingSettings>();

  constructor(private readonly deps: IImagingApplyDeps) {}

  /**
   * Apply `preset` to camera `id`. Returns the update written, or null when the camera exposes none
   * of the preset's levers (nothing is written). Throws if the underlying get/set fails.
   */
  async apply(id: string, preset: TImagingPreset): Promise<IImagingUpdate | null> {
    const current = await this.deps.getImaging(id);
    if (!this.baselines.has(id)) {
      this.baselines.set(id, current);
    }
    const baseline = this.baselines.get(id) ?? current;
    const update = computeImagingUpdate(preset, baseline);
    if (Object.keys(update).length === 0) {
      return null;
    }
    await this.deps.setImaging(id, update);
    return update;
  }
}
