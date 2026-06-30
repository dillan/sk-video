import type { ISnapshotTelemetry } from '../recording/snapshot-service';
import { computeBundleDigest } from './bundle-digest';
import type {
  IIncidentAsset,
  IIncidentBundle,
  IIncidentFailure,
  IIncidentTelemetrySummary,
  IIncidentTrigger,
  TIncidentStatus,
} from './incident-validation';

/**
 * Pure assembly of the IIncidentBundle manifest from already-collected parts, plus the honest status
 * computation, so the orchestrator stays thin. Sets evidence:'best-effort', folds the bundle digest,
 * and derives status from clip outcomes + recorded failures (never silently "complete").
 */

/**
 * complete = a clip for every requested camera and no failures; failed = nothing usable captured;
 * otherwise partial (some coverage missing or a sub-capture failed but useful evidence exists).
 */
export function computeStatus(
  cameras: string[],
  assets: IIncidentAsset[],
  failures: IIncidentFailure[],
): Exclude<TIncidentStatus, 'capturing'> {
  if (assets.length === 0) {
    return 'failed';
  }
  const clipCount = assets.filter((a) => a.kind === 'clip').length;
  // Require real camera coverage before claiming complete — a zero-camera, telemetry-only bundle is
  // not "complete" evidence, it's partial.
  if (cameras.length > 0 && clipCount >= cameras.length && failures.length === 0) {
    return 'complete';
  }
  return 'partial';
}

export interface IBundleParts {
  id: string;
  createdAt: number;
  finalizedAt: number;
  trigger: IIncidentTrigger;
  window: { preMs: number; postMs: number };
  cameras: string[];
  telemetryAtTrigger: ISnapshotTelemetry;
  telemetry: IIncidentTelemetrySummary;
  assets: IIncidentAsset[];
  failures: IIncidentFailure[];
  label?: string;
  notes?: string;
  pinned?: boolean;
}

/** Build the final, honest manifest: best-effort evidence, derived status, and a self-consistency digest. */
export function buildManifest(parts: IBundleParts): IIncidentBundle {
  const digest = computeBundleDigest({
    id: parts.id,
    createdAt: parts.createdAt,
    assets: parts.assets.map((a) => ({ id: a.id, sha256: a.sha256, size: a.size })),
  });
  return {
    id: parts.id,
    schemaVersion: 1,
    createdAt: parts.createdAt,
    finalizedAt: parts.finalizedAt,
    status: computeStatus(parts.cameras, parts.assets, parts.failures),
    evidence: 'best-effort',
    trigger: parts.trigger,
    window: parts.window,
    cameras: parts.cameras,
    telemetryAtTrigger: parts.telemetryAtTrigger,
    telemetry: parts.telemetry,
    assets: parts.assets,
    failures: parts.failures,
    digest: { algo: 'sha256', value: digest },
    ...(parts.label !== undefined ? { label: parts.label } : {}),
    ...(parts.notes !== undefined ? { notes: parts.notes } : {}),
    ...(parts.pinned !== undefined ? { pinned: parts.pinned } : {}),
  };
}
