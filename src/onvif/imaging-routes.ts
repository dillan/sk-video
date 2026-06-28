import type { IRouter, Request, Response } from 'express';
import { redactUrl } from '../security/redact';
import type { IImagingSettings, IImagingUpdate } from './onvif-controller';
import {
  isImagingPreset,
  computeImagingUpdate,
  availableControls,
  capablePresets,
} from './imaging-presets';

/**
 * Same-origin imaging endpoints. GET reports the camera's CURRENT settings + the controls/presets it
 * can actually act on; POST applies a marine preset (Day/Night/Fog/Glare/Auto) gated to those levers
 * and relative to current. Vendor-quirky and best-effort — the camera may clamp or ignore writes. The
 * controller IO is injected so the routes are testable without a live ONVIF camera.
 */

export interface IImagingRouteDeps {
  ready: () => boolean;
  hasCamera: (id: string) => boolean;
  getImaging: (id: string) => Promise<IImagingSettings>;
  setImaging: (id: string, update: IImagingUpdate) => Promise<void>;
}

function errorBody(err: unknown, fallback: string): { error: string } {
  return { error: redactUrl(err instanceof Error ? err.message : fallback) };
}

export function registerImagingRoutes(router: IRouter, deps: IImagingRouteDeps): void {
  // Per-camera session baseline: the settings the first time a preset is applied. Presets are computed
  // relative to this fixed baseline, so re-applying never compounds and Auto/Day restore it.
  const baselines = new Map<string, IImagingSettings>();

  router.get('/cameras/:id/imaging', async (req: Request, res: Response) => {
    if (!deps.ready()) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const id = String(req.params.id);
    if (!deps.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    try {
      const settings = await deps.getImaging(id);
      res.json({
        settings,
        controls: availableControls(settings),
        presets: capablePresets(settings),
      });
    } catch (err) {
      res.status(502).json(errorBody(err, 'imaging read failed'));
    }
  });

  router.post('/cameras/:id/imaging/preset', async (req: Request, res: Response) => {
    if (!deps.ready()) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const id = String(req.params.id);
    if (!deps.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    const preset = (req.body as { preset?: unknown })?.preset;
    if (!isImagingPreset(preset)) {
      res.status(400).json({ error: 'unknown imaging preset' });
      return;
    }
    try {
      const current = await deps.getImaging(id);
      // Capture the session baseline on first use, then compute every preset against it (idempotent).
      if (!baselines.has(id)) {
        baselines.set(id, current);
      }
      const baseline = baselines.get(id) ?? current;
      const update = computeImagingUpdate(preset, baseline);
      if (Object.keys(update).length === 0) {
        res.status(409).json({ error: "camera exposes none of this preset's imaging controls" });
        return;
      }
      await deps.setImaging(id, update);
      res.json({
        preset,
        applied: update,
        note: 'best-effort — the camera may clamp or ignore values; Fog/Glare cannot see through dense fog. Auto/Day restore the tone levers.',
      });
    } catch (err) {
      res.status(502).json(errorBody(err, 'imaging write failed'));
    }
  });
}
