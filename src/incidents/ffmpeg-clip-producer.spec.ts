import { describe, it, expect } from 'vitest';
import { createFfmpegClipProducer, type IClipChild } from './ffmpeg-clip-producer';
import { planClip, concatListContent } from './incident-clip';
import type { ISegmentSelection } from './incident-window';

const sel: ISegmentSelection = {
  segments: [
    { cameraId: 'bow', path: '/rec/a.mp4', startedAt: 0, bytes: 1 },
    { cameraId: 'bow', path: '/rec/b.mp4', startedAt: 0, bytes: 1 },
  ],
  spanStartMs: 0,
  spanEndMs: 120_000,
  contiguous: true,
};
const plan = planClip(sel, 0, 60_000);

/** A fake child that fires `close` with the given code on next tick. */
function fakeChild(code: number | null, errorFirst = false): IClipChild {
  const handlers: Record<string, (arg: unknown) => void> = {};
  queueMicrotask(() => {
    if (errorFirst) {
      handlers.error?.(new Error('spawn failed'));
    } else {
      handlers.close?.(code as never);
    }
  });
  return {
    on(event: string, cb: (arg: never) => void) {
      handlers[event] = cb as (arg: unknown) => void;
    },
  } as IClipChild;
}

function setup(child: IClipChild) {
  const writes: { path: string; data: string }[] = [];
  const removed: string[] = [];
  const producer = createFfmpegClipProducer({
    spawn: () => child,
    writeFile: (path, data) => writes.push({ path, data }),
    readFile: async () => new Uint8Array([9, 9, 9]),
    removeFile: (path) => removed.push(path),
    tmpDir: () => '/tmp/sk',
    idGen: () => 'fixed',
  });
  return { producer, writes, removed };
}

describe('createFfmpegClipProducer', () => {
  it('writes the concat list, spawns, and returns the output bytes on a clean exit', async () => {
    const { producer, writes, removed } = setup(fakeChild(0));
    const result = await producer(plan);
    expect(result.ok).toBe(true);
    expect(Array.from(result.bytes!)).toEqual([9, 9, 9]);
    expect(writes[0]).toEqual({ path: '/tmp/sk/fixed.txt', data: concatListContent(plan.inputs) });
    // temp list + output are cleaned up
    expect(removed).toEqual(['/tmp/sk/fixed.txt', '/tmp/sk/fixed.mp4']);
  });

  it('returns ok:false on a non-zero exit', async () => {
    const { producer } = setup(fakeChild(1));
    expect((await producer(plan)).ok).toBe(false);
  });

  it('returns ok:false when ffmpeg errors', async () => {
    const { producer } = setup(fakeChild(null, true));
    expect((await producer(plan)).ok).toBe(false);
  });
});
