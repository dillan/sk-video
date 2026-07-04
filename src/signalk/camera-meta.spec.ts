import { describe, it, expect } from 'vitest';
import { feedOutagePath, buildCameraHealthMeta } from './camera-meta';

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
