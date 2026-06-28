import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSnapshotStore, isValidSnapshotId } from './file-snapshot-store';
import { SnapshotService, type ISnapshotMetadata } from './snapshot-service';
import { SignalKBridge, type ISignalKApp } from '../signalk/sk-bridge';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sk-snap-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('FileSnapshotStore', () => {
  it('writes the blob and sidecar owner-only and reads them back', () => {
    const dir = tempDir();
    const store = new FileSnapshotStore(dir);
    const meta: ISnapshotMetadata = {
      id: 'snap-1',
      cameraId: 'bow',
      createdAt: 1,
      contentType: 'image/jpeg',
      size: JPEG.length,
      telemetry: {
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
    };
    store.save(JPEG, meta);
    expect(store.get('snap-1')).toEqual(meta);
    expect(store.list()).toEqual([meta]);
    expect((statSync(store.blobPath('snap-1')).mode & 0o777).toString(8)).toBe('600');
  });

  it('rejects an unsafe id', () => {
    expect(isValidSnapshotId('../etc/passwd')).toBe(false);
    expect(() =>
      new FileSnapshotStore(tempDir()).save(JPEG, { id: '../x' } as ISnapshotMetadata),
    ).toThrow();
  });

  it('returns null/empty for a missing snapshot', () => {
    const store = new FileSnapshotStore(tempDir());
    expect(store.get('nope')).toBeNull();
    expect(store.list()).toEqual([]);
  });

  const metaAt = (id: string, createdAt: number): ISnapshotMetadata =>
    ({ id, cameraId: 'bow', createdAt, contentType: 'image/jpeg', size: JPEG.length }) as never;

  it('prunes the oldest snapshots past the count budget', () => {
    const store = new FileSnapshotStore(tempDir(), 'snapshots', { maxCount: 2 });
    store.save(JPEG, metaAt('a', 1));
    store.save(JPEG, metaAt('b', 2));
    store.save(JPEG, metaAt('c', 3));
    const ids = store
      .list()
      .map((m) => m.id)
      .sort();
    expect(ids).toEqual(['b', 'c']); // 'a' (oldest) was evicted
    expect(existsSync(store.blobPath('a'))).toBe(false);
  });

  it('prunes snapshots past the age limit', () => {
    let clock = 10_000;
    const store = new FileSnapshotStore(tempDir(), 'snapshots', {
      maxAgeMs: 1000,
      now: () => clock,
    });
    store.save(JPEG, metaAt('old', 1)); // far older than maxAgeMs at the next save
    clock = 20_000;
    store.save(JPEG, metaAt('new', 19_500));
    expect(store.list().map((m) => m.id)).toEqual(['new']);
  });
});

describe('snapshot end-to-end (bridge -> service -> disk)', () => {
  it('captures a frame, stamps it from the live Signal K bridge, and persists both files', async () => {
    const dir = tempDir();
    const app: ISignalKApp = {
      getSelfPath: (p) =>
        ({
          'navigation.position': {
            value: { latitude: 47.63, longitude: -122.34 },
            timestamp: '1970-01-01T00:00:09.000Z',
          },
          'navigation.headingTrue': { value: 2.1, timestamp: '1970-01-01T00:00:09.000Z' },
        })[p],
    };
    const bridge = new SignalKBridge(app, 'sk-video', { now: () => 10_000 });
    const store = new FileSnapshotStore(dir);
    const service = new SnapshotService({
      capture: async () => JPEG,
      selfSource: bridge,
      store,
      idGen: () => 'snap-e2e',
      now: () => 1234,
    });

    const meta = await service.capture('bow');

    // The blob and the telemetry sidecar are both on disk...
    expect(existsSync(join(dir, 'snapshots', 'snap-e2e.jpg'))).toBe(true);
    const sidecar = JSON.parse(
      readFileSync(join(dir, 'snapshots', 'snap-e2e.json'), 'utf8'),
    ) as ISnapshotMetadata;
    // ...and the persisted stamp carries the position the bridge read from the Signal K bus.
    expect(sidecar.cameraId).toBe('bow');
    expect(sidecar.telemetry.position).toEqual({ latitude: 47.63, longitude: -122.34 });
    expect(sidecar.telemetry.headingTrue).toBe(2.1);
    expect(sidecar.telemetry.positionAvailable).toBe(true);
    expect(sidecar.telemetry.oldestReadingAgeMs).toBe(1000);
    expect(meta).toEqual(sidecar);
  });
});
