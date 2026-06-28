import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileIncidentStore } from './incident-store';
import type { IIncidentBundle } from './incident-validation';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sk-inc-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function manifest(id: string, over: Partial<IIncidentBundle> = {}): IIncidentBundle {
  return {
    id,
    schemaVersion: 1,
    createdAt: 1000,
    finalizedAt: 2000,
    status: 'complete',
    evidence: 'best-effort',
    trigger: { source: 'manual', firedAt: 1000 },
    window: { preMs: 0, postMs: 0 },
    cameras: ['bow'],
    telemetryAtTrigger: {
      position: null,
      headingTrue: null,
      speedOverGround: null,
      courseOverGroundTrue: null,
      depth: null,
      windSpeedApparent: null,
      windAngleApparent: null,
      oldestReadingAgeMs: null,
      positionAvailable: false,
    },
    telemetry: {
      sampleCount: 0,
      positionAvailable: false,
      oldestReadingAgeMs: null,
      coversPreRoll: false,
      gaps: false,
      sampleIntervalMs: 1000,
    },
    assets: [
      {
        id: 'clip1',
        kind: 'clip',
        cameraId: 'bow',
        contentType: 'video/mp4',
        size: 4,
        sha256: 'x',
        name: 'bow.mp4',
        createdAt: 1000,
      },
    ],
    failures: [],
    digest: { algo: 'sha256', value: 'd' },
    ...over,
  };
}

describe('FileIncidentStore', () => {
  it('stages assets then publishes atomically — invisible until publish', () => {
    const store = new FileIncidentStore(tempDir());
    store.stageAsset('inc1', 'clip1', new Uint8Array([1, 2, 3, 4]));
    expect(store.get('inc1')).toBeNull(); // staged, not yet published
    expect(store.list()).toHaveLength(0);

    store.publish('inc1', manifest('inc1'));
    expect(store.get('inc1')?.id).toBe('inc1');
    expect(store.list().map((m) => m.id)).toEqual(['inc1']);
    expect(existsSync(store.assetPath('inc1', 'clip1'))).toBe(true);
  });

  it('summaries report bytes + pinned; usage sums them', () => {
    const store = new FileIncidentStore(tempDir());
    store.publish('inc1', manifest('inc1', { pinned: true }));
    const s = store.summaries();
    expect(s).toEqual([{ id: 'inc1', createdAt: 1000, totalBytes: 4, pinned: true }]);
    expect(store.usage()).toEqual({ totalBytes: 4, count: 1 });
  });

  it('never lists an orphan staging dir, and sweepStaging removes it', () => {
    const root = tempDir();
    const store = new FileIncidentStore(root);
    store.stageAsset('crashed', 'a', new Uint8Array([1]));
    expect(store.list()).toHaveLength(0);
    expect(store.summaries()).toHaveLength(0);
    expect(store.sweepStaging()).toBe(1);
    expect(existsSync(join(root, 'incidents', '.staging', 'crashed'))).toBe(false);
  });

  it('patch merges editable fields and rewrites the manifest', () => {
    const store = new FileIncidentStore(tempDir());
    store.publish('inc1', manifest('inc1'));
    const patched = store.patch('inc1', { label: 'grounding', pinned: true });
    expect(patched).toMatchObject({ label: 'grounding', pinned: true });
    expect(store.get('inc1')).toMatchObject({ label: 'grounding', pinned: true });
    expect(store.patch('missing', { label: 'x' })).toBeNull();
  });

  it('delete removes the whole bundle dir (cascading blobs)', () => {
    const store = new FileIncidentStore(tempDir());
    store.stageAsset('inc1', 'clip1', new Uint8Array([1, 2, 3, 4]));
    store.publish('inc1', manifest('inc1'));
    expect(store.delete('inc1')).toBe(true);
    expect(store.get('inc1')).toBeNull();
    expect(store.delete('inc1')).toBe(false);
  });

  it('rejects traversal ids on the asset path', () => {
    const store = new FileIncidentStore(tempDir());
    expect(() => store.assetPath('../x', 'a')).toThrow(/invalid/);
    expect(() => store.assetPath('inc1', '../a')).toThrow(/invalid/);
  });

  it('ignores a non-incident directory that has no manifest', () => {
    const root = tempDir();
    const store = new FileIncidentStore(root);
    mkdirSync(join(root, 'incidents', 'junk'), { recursive: true });
    store.publish('inc1', manifest('inc1'));
    expect(store.list().map((m) => m.id)).toEqual(['inc1']);
    // sanity: the junk dir really is on disk
    expect(readdirSync(join(root, 'incidents')).sort()).toContain('junk');
  });
});
