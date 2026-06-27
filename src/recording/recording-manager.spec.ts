import { describe, it, expect, vi } from 'vitest';
import { RecordingManager, type IRecordingManagerDeps } from './recording-manager';
import type { ISegment } from './recording-segments';

function setup(over: Partial<IRecordingManagerDeps> = {}) {
  const spawned: { args: string[]; stop: ReturnType<typeof vi.fn> }[] = [];
  const removed: string[] = [];
  const deps: IRecordingManagerDeps = {
    dir: '/rec',
    rtspBase: () => 'rtsp://127.0.0.1:8554',
    spawnRecorder: (args) => {
      const proc = { args, stop: vi.fn() };
      spawned.push(proc);
      return proc;
    },
    maxChannels: () => 4,
    limits: () => ({ maxBytes: 1_000_000, maxAgeMs: 86_400_000 }),
    listSegments: () => [],
    removeFile: (p) => removed.push(p),
    ...over,
  };
  return { mgr: new RecordingManager(deps), spawned, removed };
}

describe('RecordingManager', () => {
  it('spawns an ffmpeg recorder for the camera loopback stream and tracks it', () => {
    const { mgr, spawned } = setup();
    expect(mgr.start('bow')).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].args).toContain('rtsp://127.0.0.1:8554/bow');
    expect(spawned[0].args[spawned[0].args.length - 1]).toBe('/rec/bow_%Y%m%d_%H%M%S.mp4');
    expect(mgr.isRecording('bow')).toBe(true);
    expect(mgr.activeCameras()).toEqual(['bow']);
  });

  it('is idempotent — starting an already-recording camera does not spawn again', () => {
    const { mgr, spawned } = setup();
    mgr.start('bow');
    expect(mgr.start('bow')).toBe(true);
    expect(spawned).toHaveLength(1);
  });

  it('refuses to record when the tier disables it (0 channels)', () => {
    const { mgr, spawned } = setup({ maxChannels: () => 0 });
    expect(mgr.start('bow')).toBe(false);
    expect(spawned).toHaveLength(0);
  });

  it('enforces the channel cap', () => {
    const { mgr, spawned } = setup({ maxChannels: () => 2 });
    expect(mgr.start('a')).toBe(true);
    expect(mgr.start('b')).toBe(true);
    expect(mgr.start('c')).toBe(false); // over the cap
    expect(spawned).toHaveLength(2);
  });

  it('stop kills the recorder and untracks it; stopAll kills every recorder', () => {
    const { mgr, spawned } = setup();
    mgr.start('a');
    mgr.start('b');
    mgr.stop('a');
    expect(spawned[0].stop).toHaveBeenCalledTimes(1);
    expect(mgr.isRecording('a')).toBe(false);
    expect(mgr.activeCameras()).toEqual(['b']);
    mgr.stopAll();
    expect(spawned[1].stop).toHaveBeenCalledTimes(1);
    expect(mgr.activeCameras()).toEqual([]);
  });

  it('sweep prunes segments past the retention budget and reports the count', () => {
    const segs: ISegment[] = [
      { cameraId: 'a', path: '/rec/old.mp4', startedAt: 0, bytes: 100 },
      { cameraId: 'a', path: '/rec/new.mp4', startedAt: 9_000_000, bytes: 100 },
    ];
    const { mgr, removed } = setup({
      listSegments: () => segs,
      limits: () => ({ maxBytes: 1e9, maxAgeMs: 5_000_000 }),
    });
    // old is 10_000_000 ms old (pruned); new is 1_000_000 ms old (kept).
    expect(mgr.sweep(10_000_000)).toBe(1);
    expect(removed).toEqual(['/rec/old.mp4']);
  });
});
