import { randomUUID } from 'node:crypto';
import type { ISegment } from '../recording/recording-segments';
import type { ISelfState } from '../signalk/sk-bridge';
import { toTelemetry, type ISnapshotTelemetry } from '../recording/snapshot-service';
import { selectClipSegments, type ISegmentTimeParts } from './incident-window';
import { planClip, type IClipPlan } from './incident-clip';
import { TelemetrySampler, telemetryTrackBytes } from './telemetry-track';
import { hashBytes } from './bundle-digest';
import { buildManifest } from './incident-bundle';
import {
  sanitizeText,
  type IIncidentAsset,
  type IIncidentFailure,
  type IIncidentTrigger,
} from './incident-validation';
import type { IIncidentStore } from './incident-store';

// Bounds for the untrusted trigger fields the Signal K auto-trigger carries (the manual path is
// already bounded by validateTriggerRequest); keeps an attacker-supplied notification from bloating
// the in-memory assembly and the manifest.
const MAX_TRIGGER_REASON = 2000;
const MAX_TRIGGER_PATH = 256;
const MAX_TRIGGER_STATE = 32;

/**
 * The behavioral heart of C9: a MobController-shaped orchestrator with every IO injected (clock,
 * timers, snapshot capture, clip producer, store, notifications). mark() validates the window,
 * stamps trigger telemetry, kicks off a best-effort snapshot per camera, samples telemetry over the
 * post-roll, raises the 'incident' notification, and schedules finalize at T0+postMs+grace.
 * finalize() stages each captured snapshot, cuts a clip per camera from the DVR segments (or records
 * a failure), stages the telemetry track, hashes every asset, builds the manifest and publishes it
 * atomically, then clears the notification. cancelAll() clears every timer so no finalize runs after
 * stop(). All staging uses the known incident id inside finalize, so nothing is written under a
 * guessed id.
 */

type Timer = ReturnType<typeof setTimeout>;

export interface ISnapshotResult {
  bytes: Uint8Array;
  contentType: string;
  telemetry: ISnapshotTelemetry;
}

export interface IIncidentControllerDeps {
  store: IIncidentStore;
  captureSnapshot: (cameraId: string) => Promise<ISnapshotResult>;
  produceClip: (plan: IClipPlan) => Promise<{ ok: boolean; bytes?: Uint8Array }>;
  listSegments: () => ISegment[];
  getSelfState: () => ISelfState;
  relevantCameras: () => string[];
  raiseNotification: (message: string, data?: Record<string, unknown>) => void;
  clearNotification: () => void;
  segmentSeconds: number;
  defaultPreMs: number;
  defaultPostMs: number;
  sampleIntervalMs: number;
  finalizeGraceMs: number;
  makeEpoch?: (p: ISegmentTimeParts) => number;
  idGen?: () => string;
  now?: () => number;
  setTimeoutImpl?: (fn: () => void, ms: number) => Timer;
  clearTimeoutImpl?: (t: Timer) => void;
  setIntervalImpl?: (fn: () => void, ms: number) => Timer;
  clearIntervalImpl?: (t: Timer) => void;
  /** Optional: best-effort start a recorder at trigger so the post-roll is captured. Unwired by default. */
  ensureRecording?: (cameraId: string) => void;
  log?: (msg: string) => void;
}

export interface IMarkInput {
  cameras?: string[];
  preMs?: number;
  postMs?: number;
  note?: string;
  source: 'manual' | 'signalk';
  path?: string;
  state?: string;
  /** Suppress this capture's own incident notification — the caller owns a consolidated one (C3). */
  silent?: boolean;
}

interface IRawSnapshot {
  cameraId: string;
  ok: boolean;
  bytes?: Uint8Array;
  contentType?: string;
  reason?: string;
}

interface IAssembly {
  id: string;
  createdAt: number;
  cameras: string[];
  preMs: number;
  postMs: number;
  trigger: IIncidentTrigger;
  telemetryAtTrigger: ISnapshotTelemetry;
  sampler: TelemetrySampler;
  snapshots: Promise<IRawSnapshot>[];
  finalizeTimer: Timer | null;
  sampleTimer: Timer | null;
  silent: boolean;
}

export class IncidentController {
  private readonly active = new Map<string, IAssembly>();
  private disposed = false;
  private readonly idGen: () => string;
  private readonly now: () => number;
  private readonly setTimeoutImpl: NonNullable<IIncidentControllerDeps['setTimeoutImpl']>;
  private readonly clearTimeoutImpl: NonNullable<IIncidentControllerDeps['clearTimeoutImpl']>;
  private readonly setIntervalImpl: NonNullable<IIncidentControllerDeps['setIntervalImpl']>;
  private readonly clearIntervalImpl: NonNullable<IIncidentControllerDeps['clearIntervalImpl']>;

  constructor(private readonly deps: IIncidentControllerDeps) {
    this.idGen = deps.idGen ?? (() => randomUUID());
    this.now = deps.now ?? (() => Date.now());
    this.setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout;
    this.setIntervalImpl = deps.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;
  }

  /** Trigger an incident capture. Returns synchronously; the bundle finalizes in the background. */
  mark(input: IMarkInput): { id: string; status: 'capturing' } {
    const t0 = this.now();
    const id = this.idGen();
    const cameras = input.cameras ?? this.deps.relevantCameras();
    const preMs = input.preMs ?? this.deps.defaultPreMs;
    const postMs = input.postMs ?? this.deps.defaultPostMs;
    const telemetryAtTrigger = toTelemetry(this.deps.getSelfState());

    // Bound every trigger field — the auto-trigger feeds untrusted, unbounded notification text here.
    const path = sanitizeText(input.path, MAX_TRIGGER_PATH);
    const state = sanitizeText(input.state, MAX_TRIGGER_STATE);
    const reason = sanitizeText(input.note, MAX_TRIGGER_REASON);
    const trigger: IIncidentTrigger = {
      source: input.source,
      firedAt: t0,
      ...(path ? { path } : {}),
      ...(state ? { state } : {}),
      ...(reason ? { reason } : {}),
    };

    if (!input.silent) {
      this.deps.raiseNotification(this.notifyMessage(cameras, input), { id });
    }

    const sampler = new TelemetrySampler({
      anchorMs: t0,
      expectedIntervalMs: this.deps.sampleIntervalMs,
    });
    sampler.push(t0, this.deps.getSelfState());

    for (const cameraId of cameras) {
      this.deps.ensureRecording?.(cameraId);
    }

    // Capture snapshot BYTES now (at T0); staging happens in finalize under the known id.
    const snapshots = cameras.map((cameraId) => this.captureSnapshotRaw(cameraId));

    const assembly: IAssembly = {
      id,
      createdAt: t0,
      cameras,
      preMs,
      postMs,
      trigger,
      telemetryAtTrigger,
      sampler,
      snapshots,
      finalizeTimer: null,
      sampleTimer: null,
      silent: input.silent === true,
    };

    if (this.deps.sampleIntervalMs > 0 && postMs > 0) {
      assembly.sampleTimer = this.setIntervalImpl(() => {
        sampler.push(this.now(), this.deps.getSelfState());
      }, this.deps.sampleIntervalMs);
    }

    assembly.finalizeTimer = this.setTimeoutImpl(
      () => {
        void this.finalize(id);
      },
      Math.max(0, postMs) + this.deps.finalizeGraceMs,
    );

    this.active.set(id, assembly);
    return { id, status: 'capturing' };
  }

  activeAssemblies(): { id: string; createdAt: number }[] {
    return [...this.active.values()].map((a) => ({ id: a.id, createdAt: a.createdAt }));
  }

  /** Clear every in-flight timer so no finalize runs after the plugin stops. */
  cancelAll(): void {
    // Mark disposed so a finalize already past its synchronous guard bails before spawning ffmpeg or
    // publishing — a restart's sweepStaging() could otherwise wipe its staged blobs out from under it.
    this.disposed = true;
    for (const a of this.active.values()) {
      if (a.finalizeTimer !== null) {
        this.clearTimeoutImpl(a.finalizeTimer);
      }
      if (a.sampleTimer !== null) {
        this.clearIntervalImpl(a.sampleTimer);
      }
      try {
        this.deps.store.abandon(a.id);
      } catch {
        /* best effort */
      }
    }
    this.active.clear();
  }

  private async captureSnapshotRaw(cameraId: string): Promise<IRawSnapshot> {
    try {
      const snap = await this.deps.captureSnapshot(cameraId);
      return { cameraId, ok: true, bytes: snap.bytes, contentType: snap.contentType };
    } catch (err) {
      return { cameraId, ok: false, reason: errMessage(err) };
    }
  }

  private async finalize(id: string): Promise<void> {
    const assembly = this.active.get(id);
    if (!assembly) {
      return; // already finalized, or cancelled
    }
    this.active.delete(id);
    if (assembly.sampleTimer !== null) {
      this.clearIntervalImpl(assembly.sampleTimer);
    }

    try {
      const windowStartMs = assembly.createdAt - assembly.preMs;
      const windowEndMs = assembly.createdAt + assembly.postMs;
      const assets: IIncidentAsset[] = [];
      const failures: IIncidentFailure[] = [];

      // Stage the snapshots captured at T0 under the now-known incident id.
      for (const snap of await Promise.all(assembly.snapshots)) {
        if (snap.ok && snap.bytes) {
          const assetId = this.idGen();
          this.deps.store.stageAsset(id, assetId, snap.bytes);
          assets.push({
            id: assetId,
            kind: 'snapshot',
            cameraId: snap.cameraId,
            contentType: snap.contentType ?? 'image/jpeg',
            size: snap.bytes.length,
            sha256: hashBytes(snap.bytes),
            name: `${snap.cameraId}-snapshot${ext(snap.contentType)}`,
            createdAt: this.now(),
          });
        } else {
          failures.push({
            kind: 'snapshot',
            cameraId: snap.cameraId,
            reason: snap.reason ?? 'snapshot failed',
          });
        }
      }

      // Bail before the expensive ffmpeg work if the plugin is tearing down — abandon the staging
      // rather than publish a bundle whose blobs a restart's sweepStaging() may delete.
      if (this.disposed) {
        this.deps.store.abandon(id);
        return;
      }

      for (const cameraId of assembly.cameras) {
        const clip = await this.cutClip(id, cameraId, windowStartMs, windowEndMs);
        if (clip.asset) {
          assets.push(clip.asset);
        } else if (clip.failure) {
          failures.push(clip.failure);
        }
      }

      // The telemetry track is always written — the one asset that cannot fail to capture.
      const trackBytes = telemetryTrackBytes(assembly.sampler.track());
      const trackId = this.idGen();
      this.deps.store.stageAsset(id, trackId, trackBytes);
      assets.push({
        id: trackId,
        kind: 'telemetry',
        cameraId: null,
        contentType: 'application/json',
        size: trackBytes.length,
        sha256: hashBytes(trackBytes),
        name: 'telemetry.json',
        createdAt: this.now(),
      });

      // Last disposed check just before the atomic publish: if a teardown raced in during the clip
      // cuts, abandon rather than publish a bundle a restart sweep could orphan.
      if (this.disposed) {
        this.deps.store.abandon(id);
        return;
      }

      const manifest = buildManifest({
        id,
        createdAt: assembly.createdAt,
        finalizedAt: this.now(),
        trigger: assembly.trigger,
        window: { preMs: assembly.preMs, postMs: assembly.postMs },
        cameras: assembly.cameras,
        telemetryAtTrigger: assembly.telemetryAtTrigger,
        telemetry: assembly.sampler.summary(windowEndMs),
        assets,
        failures,
      });
      this.deps.store.publish(id, manifest);
    } catch (err) {
      this.deps.log?.(`incident ${id} finalize failed: ${errMessage(err)}`);
      try {
        this.deps.store.abandon(id);
      } catch {
        /* best effort */
      }
    } finally {
      // clearNotification reaches the server's notifications API, which may throw; the "finalize
      // never throws" guarantee must hold even then (this runs fire-and-forget as void finalize()).
      // A silent capture never raised its own notification (the C3 watch owns a consolidated one).
      if (!assembly.silent) {
        try {
          this.deps.clearNotification();
        } catch {
          /* best effort */
        }
      }
    }
  }

  private async cutClip(
    id: string,
    cameraId: string,
    windowStartMs: number,
    windowEndMs: number,
  ): Promise<{ asset?: IIncidentAsset; failure?: IIncidentFailure }> {
    const selection = selectClipSegments(
      this.deps.listSegments(),
      cameraId,
      windowStartMs,
      windowEndMs,
      this.deps.segmentSeconds,
      this.deps.makeEpoch,
    );
    if (!selection) {
      return {
        failure: { kind: 'clip', cameraId, reason: 'no DVR segments overlapped the window' },
      };
    }
    const plan = planClip(selection, windowStartMs, windowEndMs);
    const clip = await this.deps.produceClip(plan);
    if (!clip.ok || !clip.bytes) {
      return { failure: { kind: 'clip', cameraId, reason: 'clip extraction failed' } };
    }
    const assetId = this.idGen();
    this.deps.store.stageAsset(id, assetId, clip.bytes);
    return {
      asset: {
        id: assetId,
        kind: 'clip',
        cameraId,
        contentType: 'video/mp4',
        size: clip.bytes.length,
        sha256: hashBytes(clip.bytes),
        name: `${cameraId}.mp4`,
        createdAt: this.now(),
        coverage: plan.coverage,
      },
    };
  }

  private notifyMessage(cameras: string[], input: IMarkInput): string {
    const what = input.source === 'signalk' ? `auto (${input.path ?? 'notification'})` : 'manual';
    const n = cameras.length;
    return `Incident capture started (${what}) — ${n} camera${n === 1 ? '' : 's'}; best-effort evidence.`;
  }
}

function ext(contentType: string | undefined): string {
  if (contentType === 'image/jpeg') {
    return '.jpg';
  }
  if (contentType === 'image/png') {
    return '.png';
  }
  return '.bin';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
