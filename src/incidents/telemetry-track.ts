import type { ISelfState } from '../signalk/sk-bridge';
import { toTelemetry, type ISnapshotTelemetry } from '../recording/snapshot-service';
import type { IIncidentTelemetrySummary } from './incident-validation';

/**
 * Pure accumulator for the sampled telemetry track. Each push() appends a sample built with the
 * existing snapshot honesty rules (null fields, oldest-reading age, positionAvailable) by reusing
 * toTelemetry. The interval timer that drives push lives in the controller (IO), not here. The track
 * is forward-only from T0 — the bridge offers only getSelfState polling, so there is no historical
 * (pre-roll) telemetry; coversPreRoll is therefore always false.
 */

export interface ITelemetrySample {
  atMs: number;
  telemetry: ISnapshotTelemetry;
}

export interface ITelemetryTrack {
  sampleIntervalMs: number;
  samples: ITelemetrySample[];
}

export class TelemetrySampler {
  private readonly samples: ITelemetrySample[] = [];

  constructor(private readonly opts: { anchorMs: number; expectedIntervalMs: number }) {}

  /** Append one sample stamped at `now` from the current self-state. */
  push(now: number, state: ISelfState): void {
    this.samples.push({ atMs: now, telemetry: toTelemetry(state) });
  }

  track(): ITelemetryTrack {
    return { sampleIntervalMs: this.opts.expectedIntervalMs, samples: [...this.samples] };
  }

  /** Summary over [anchor, endMs], honestly flagging gaps and that pre-roll is never covered. */
  summary(endMs: number): IIncidentTelemetrySummary {
    const ages = this.samples
      .map((s) => s.telemetry.oldestReadingAgeMs)
      .filter((a): a is number => a !== null);
    const positionAvailable = this.samples.some((s) => s.telemetry.positionAvailable);

    // Expected sample count over the post-roll if every tick fired; fewer means gaps.
    const span = Math.max(0, endMs - this.opts.anchorMs);
    const expected =
      this.opts.expectedIntervalMs > 0 ? Math.floor(span / this.opts.expectedIntervalMs) + 1 : 1;
    const gaps = this.samples.length < expected;

    return {
      sampleCount: this.samples.length,
      positionAvailable,
      oldestReadingAgeMs: ages.length ? Math.max(...ages) : null,
      coversPreRoll: false,
      gaps,
      sampleIntervalMs: this.opts.expectedIntervalMs,
    };
  }
}

/** Serialize the track to JSON bytes for storage as the bundle's telemetry asset. */
export function telemetryTrackBytes(track: ITelemetryTrack): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(track, null, 2));
}
