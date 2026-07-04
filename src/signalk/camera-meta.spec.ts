import { describe, it, expect } from 'vitest';
import {
  feedOutagePath,
  buildCameraHealthMeta,
  zonesForThresholds,
  buildCameraHealthTeardown,
} from './camera-meta';

describe('camera health meta', () => {
  it('derives the gauge path from the camera id', () => {
    expect(feedOutagePath('bow')).toBe('cameras.bow.feedOutage');
  });

  it('builds displayName/units/timeout meta for the gauge and counts', () => {
    const meta = buildCameraHealthMeta({ id: 'bow', name: 'Bow Camera', pollSeconds: 15 });
    expect(meta).toEqual([
      {
        path: 'cameras.bow.feedOutage',
        value: {
          displayName: 'Bow Camera — feed outage',
          description: 'Seconds since this camera last produced video.',
          units: 's',
          timeout: 30, // 2× the poll, so clients can flag a stale reading on their own
        },
      },
      {
        path: 'cameras.bow.producers',
        value: { displayName: 'Bow Camera — producers' },
      },
      {
        path: 'cameras.bow.consumers',
        value: { displayName: 'Bow Camera — viewers' },
      },
    ]);
  });

  it('attaches zones to the gauge meta when provided (server-evaluated alarm handover)', () => {
    const meta = buildCameraHealthMeta({
      id: 'bow',
      name: 'Bow Camera',
      pollSeconds: 15,
      zones: [
        { lower: 45, upper: 120, state: 'warn', message: 'Bow Camera feed is stalling' },
        { lower: 120, state: 'alarm', message: 'Bow Camera has gone dark' },
      ],
    });
    const gauge = meta[0].value as { zones?: unknown };
    expect(gauge.zones).toEqual([
      { lower: 45, upper: 120, state: 'warn', message: 'Bow Camera feed is stalling' },
      { lower: 120, state: 'alarm', message: 'Bow Camera has gone dark' },
    ]);
    // Counts never carry zones — only the gauge alarms.
    expect((meta[1].value as { zones?: unknown }).zones).toBeUndefined();
  });
});

describe('zonesForThresholds', () => {
  it('maps warn/alarm seconds to contiguous warn + alarm zones with human messages', () => {
    expect(
      zonesForThresholds('Bow Camera', { warnAfterSeconds: 45, alarmAfterSeconds: 120 }),
    ).toEqual([
      // upper is exclusive in the server's zone test, so the warn band hands over exactly at alarm
      { lower: 45, upper: 120, state: 'warn', message: 'Bow Camera feed is stalling' },
      { lower: 120, state: 'alarm', message: 'Bow Camera has gone dark' },
    ]);
  });
});

describe('buildCameraHealthTeardown', () => {
  it('returns the in-normal-zone final value and the zones-clearing meta, in that order', () => {
    // A camera deleted while its gauge sits in an alarm zone would otherwise leave a
    // permanently-stuck server-raised notification — the teardown drives it back to normal
    // and then disarms the zone watcher.
    const teardown = buildCameraHealthTeardown('bow');
    expect(teardown.finalValue).toEqual({ path: 'cameras.bow.feedOutage', value: 0 });
    expect(teardown.clearZonesMeta).toEqual({
      path: 'cameras.bow.feedOutage',
      value: { zones: null },
    });
  });
});
