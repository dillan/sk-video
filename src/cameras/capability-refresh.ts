import type { ICamera } from './camera-validation';
import { mergeDiscovered } from './camera-merge';
import type { IIntrospectResult } from '../onvif/onvif-introspect';

/**
 * Auto re-scan capabilities when a camera's firmware changes. On start we cheaply probe each camera's
 * current firmware; if it differs from what we last stored (including the first time, when none is
 * stored — which backfills capabilities for cameras added before capability discovery existed), we run
 * a full introspection and update the resource. Best-effort per camera: a probe/scan failure is logged
 * and skipped, never blocking start. All deps are injected so this is testable without real cameras.
 */

export interface ICapabilityRefreshDeps {
  /** Cameras to consider, as [id, camera] pairs. */
  cameras: () => Array<[string, ICamera]>;
  /** Cheap probe of the camera's current firmware (undefined when unavailable). */
  probeFirmware: (id: string, camera: ICamera) => Promise<string | undefined>;
  /** Full ONVIF introspection (only run when firmware changed). */
  introspect: (id: string, camera: ICamera) => Promise<IIntrospectResult>;
  /** Persist the merged camera resource (validates + writes). */
  save: (id: string, camera: ICamera) => Promise<void>;
  log: (message: string) => void;
}

export interface ICapabilityRefreshResult {
  checked: number;
  rescanned: string[];
}

export async function refreshChangedCameras(
  deps: ICapabilityRefreshDeps,
): Promise<ICapabilityRefreshResult> {
  const rescanned: string[] = [];
  const entries = deps.cameras();
  for (const [id, camera] of entries) {
    try {
      const firmware = await deps.probeFirmware(id, camera);
      if (firmware === undefined) continue; // couldn't read it (offline / no ONVIF) — leave as-is
      const stored = camera.device?.firmware;
      if (firmware === stored) continue; // unchanged — nothing to do
      const result = await deps.introspect(id, camera);
      await deps.save(id, mergeDiscovered(camera, result));
      rescanned.push(id);
      deps.log(
        stored === undefined
          ? `capability-refresh: ${id} — recorded firmware ${firmware}, capabilities refreshed`
          : `capability-refresh: ${id} — firmware ${stored} → ${firmware}, capabilities re-scanned`,
      );
    } catch (err) {
      deps.log(
        `capability-refresh: ${id} — skipped (${err instanceof Error ? err.message : 'probe failed'})`,
      );
    }
  }
  return { checked: entries.length, rescanned };
}
