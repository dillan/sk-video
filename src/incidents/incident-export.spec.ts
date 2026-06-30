import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { buildIncidentZip } from './incident-export';
import type { IIncidentBundle } from './incident-validation';

function bundle(over: Partial<IIncidentBundle> = {}): IIncidentBundle {
  return {
    id: 'inc-1',
    schemaVersion: 1,
    createdAt: 1_700_000_000_000,
    finalizedAt: 1_700_000_030_000,
    status: 'partial',
    evidence: 'best-effort',
    trigger: { source: 'manual', firedAt: 1_700_000_000_000 },
    window: { preMs: 5000, postMs: 10000 },
    cameras: ['bow', 'stern'],
    telemetryAtTrigger: { positionAvailable: false, position: null } as never,
    telemetry: {
      sampleCount: 3,
      positionAvailable: false,
      oldestReadingAgeMs: null,
      coversPreRoll: false,
      gaps: false,
      sampleIntervalMs: 1000,
    },
    assets: [
      {
        id: 'a-clip',
        kind: 'clip',
        cameraId: 'bow',
        contentType: 'video/mp4',
        size: 4,
        sha256: 'deadbeef',
        name: 'bow.mp4',
        createdAt: 1_700_000_010_000,
      },
      {
        id: 'a-tel',
        kind: 'telemetry',
        cameraId: null,
        contentType: 'application/json',
        size: 2,
        sha256: 'cafe',
        name: 'telemetry.json',
        createdAt: 1_700_000_010_000,
      },
    ],
    failures: [{ kind: 'clip', cameraId: 'stern', reason: 'camera offline' }],
    digest: { algo: 'sha256', value: 'abc123' },
    label: 'Dock incident',
    notes: 'Reviewed by crew',
    ...over,
  };
}

/** Read a zip buffer back into a name→text map for assertions. */
function entries(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of new AdmZip(buf).getEntries()) out[e.entryName] = e.getData().toString('utf8');
  return out;
}

describe('buildIncidentZip', () => {
  it('packs the manifest, a README, and each present asset under a kind folder', () => {
    const reads: Record<string, Buffer> = {
      'a-clip': Buffer.from('MP4!'),
      'a-tel': Buffer.from('[]'),
    };
    const { buffer, skipped } = buildIncidentZip(bundle(), (id) => reads[id] ?? null);
    const e = entries(buffer);

    expect(Object.keys(e).sort()).toEqual(
      ['README.txt', 'clips/bow.mp4', 'manifest.json', 'telemetry/telemetry.json'].sort(),
    );
    expect(JSON.parse(e['manifest.json']).id).toBe('inc-1');
    expect(e['clips/bow.mp4']).toBe('MP4!');
    expect(skipped).toEqual([]);
  });

  it('is honest in the README: best-effort, sha256 = file integrity, partial coverage', () => {
    const { buffer } = buildIncidentZip(bundle(), () => Buffer.from('x'));
    const readme = entries(buffer)['README.txt'];
    expect(readme).toMatch(/best-effort/i);
    expect(readme).toMatch(/not a certified VDR/i);
    expect(readme).toMatch(/file integrity/i); // sha256 framing, not chain-of-custody
    expect(readme).toMatch(/Dock incident/); // the operator label
    expect(readme).toMatch(/camera offline/); // the failure is surfaced, not hidden
  });

  it('skips an asset whose blob is missing rather than aborting the whole export', () => {
    const { buffer, skipped } = buildIncidentZip(bundle(), (id) =>
      id === 'a-clip' ? Buffer.from('MP4!') : null,
    );
    const e = entries(buffer);
    expect(e['clips/bow.mp4']).toBe('MP4!');
    expect(e['telemetry/telemetry.json']).toBeUndefined();
    expect(skipped).toEqual(['a-tel']);
    // the README notes what couldn't be included
    expect(e['README.txt']).toMatch(/could not be read/i);
  });

  it('disambiguates two assets that sanitize to the same entry name', () => {
    const b = bundle({
      assets: [
        {
          id: 'a1',
          kind: 'snapshot',
          cameraId: 'bow',
          contentType: 'image/jpeg',
          size: 1,
          sha256: 'x',
          name: 'shot.jpg',
          createdAt: 1,
        },
        {
          id: 'a2',
          kind: 'snapshot',
          cameraId: 'stern',
          contentType: 'image/jpeg',
          size: 1,
          sha256: 'y',
          name: 'shot.jpg',
          createdAt: 1,
        },
      ],
    });
    const e = entries(buildIncidentZip(b, () => Buffer.from('J')).buffer);
    const snaps = Object.keys(e).filter((k) => k.startsWith('snapshots/'));
    expect(snaps).toHaveLength(2); // both present, no silent overwrite
  });
});
