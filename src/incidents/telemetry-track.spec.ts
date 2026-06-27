import { describe, it, expect } from 'vitest';
import { TelemetrySampler, telemetryTrackBytes } from './telemetry-track';
import type { ISelfState, ISelfReading } from '../signalk/sk-bridge';

const reading = <T>(value: T | null, ageMs?: number): ISelfReading<T> => ({
  value,
  ...(ageMs !== undefined ? { ageMs } : {}),
});

function selfState(over: Partial<Record<'fix', boolean>> & { ageMs?: number } = {}): ISelfState {
  const hasFix = over.fix ?? true;
  return {
    position: reading(hasFix ? { latitude: 1, longitude: 2 } : null, over.ageMs),
    headingTrue: reading(0.5, over.ageMs),
    speedOverGround: reading(3),
    courseOverGroundTrue: reading(0.5),
    depth: reading(null),
    wind: { speedApparent: reading(null), angleApparent: reading(null) },
  };
}

describe('TelemetrySampler', () => {
  it('records samples and summarizes positionAvailable + oldest age, never covering pre-roll', () => {
    const s = new TelemetrySampler({ anchorMs: 1000, expectedIntervalMs: 1000 });
    s.push(1000, selfState({ ageMs: 200 }));
    s.push(2000, selfState({ ageMs: 5000 }));
    const summary = s.summary(2000);
    expect(summary.sampleCount).toBe(2);
    expect(summary.positionAvailable).toBe(true);
    expect(summary.oldestReadingAgeMs).toBe(5000);
    expect(summary.coversPreRoll).toBe(false);
    expect(summary.gaps).toBe(false);
  });

  it('reports no fix when every sample lacked a position', () => {
    const s = new TelemetrySampler({ anchorMs: 0, expectedIntervalMs: 1000 });
    s.push(0, selfState({ fix: false }));
    expect(s.summary(0).positionAvailable).toBe(false);
  });

  it('flags gaps when fewer samples than the interval implies arrived', () => {
    const s = new TelemetrySampler({ anchorMs: 0, expectedIntervalMs: 1000 });
    s.push(0, selfState()); // only 1 of an expected ~6 over a 5s span
    expect(s.summary(5000).gaps).toBe(true);
  });

  it('telemetryTrackBytes round-trips JSON', () => {
    const s = new TelemetrySampler({ anchorMs: 0, expectedIntervalMs: 1000 });
    s.push(0, selfState());
    const parsed = JSON.parse(new TextDecoder().decode(telemetryTrackBytes(s.track())));
    expect(parsed.sampleIntervalMs).toBe(1000);
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0].telemetry.positionAvailable).toBe(true);
  });
});
