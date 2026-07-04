import { describe, it, expect } from 'vitest';
import { uploadAll, type IUploadProgress, type IUploadTransport } from './upload-queue';

/** A controllable fake transport: the test drives byte progress and settles each file by hand. */
function fakeTransport() {
  const inflight: {
    file: File;
    onBytes: (sent: number) => void;
    signal?: AbortSignal;
    resolve: () => void;
    reject: (err: unknown) => void;
  }[] = [];
  const transport: IUploadTransport = (file, onBytes, signal) =>
    new Promise<unknown>((resolve, reject) => {
      const entry = { file, onBytes, signal, resolve: () => resolve({}), reject };
      signal?.addEventListener('abort', () => reject(new Error('aborted')));
      inflight.push(entry);
    });
  return { transport, inflight };
}

const file = (name: string, size: number): File =>
  new File([new Uint8Array(size)], name, { type: 'video/mp4' });

function harness(files: File[], opts: { errorText?: (err: unknown) => string } = {}) {
  const { transport, inflight } = fakeTransport();
  const updates: IUploadProgress[] = [];
  let now = 0;
  const handle = uploadAll(files, transport, {
    onProgress: (p) => updates.push(p),
    now: () => now,
    ...opts,
  });
  return {
    inflight,
    updates,
    handle,
    done: handle.done,
    tick: (ms: number) => (now += ms),
    last: () => updates[updates.length - 1],
  };
}

describe('uploadAll', () => {
  it('uploads sequentially and aggregates progress across files', async () => {
    const h = harness([file('a.mp4', 1000), file('b.mp4', 3000)]);
    await Promise.resolve();
    // Only the first file is in flight — sequential, never parallel.
    expect(h.inflight).toHaveLength(1);
    expect(h.inflight[0].file.name).toBe('a.mp4');

    h.tick(1000);
    h.inflight[0].onBytes(500);
    expect(h.last().bytesSent).toBe(500);
    expect(h.last().bytesTotal).toBe(4000);
    expect(h.last().fraction).toBeCloseTo(500 / 4000);
    expect(h.last().files[0].state).toBe('uploading');
    expect(h.last().files[1].state).toBe('queued');

    h.inflight[0].onBytes(1000);
    h.inflight[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.inflight).toHaveLength(2);
    h.tick(1000);
    h.inflight[1].onBytes(1000);
    // Aggregate carries the finished file's bytes: (1000 + 1000) / 4000.
    expect(h.last().fraction).toBeCloseTo(2000 / 4000);
    expect(h.last().files[0].state).toBe('done');

    h.inflight[1].onBytes(3000);
    h.inflight[1].resolve();
    const results = await h.done;
    expect(results.map((r) => r.state)).toEqual(['done', 'done']);
    expect(h.last().done).toBe(true);
    expect(h.last().fraction).toBe(1);
  });

  it('reports a smoothed speed and an ETA from timed byte progress', async () => {
    const h = harness([file('a.mp4', 10_000)]);
    await Promise.resolve();
    expect(h.last().bytesPerSecond).toBeNull(); // no interval measured yet
    expect(h.last().etaSeconds).toBeNull();

    h.tick(1000);
    h.inflight[0].onBytes(1000); // 1000 B over 1s → 1000 B/s
    expect(h.last().bytesPerSecond).toBeCloseTo(1000);
    expect(h.last().etaSeconds).toBeCloseTo(9); // 9000 bytes left at 1000 B/s

    h.tick(1000);
    h.inflight[0].onBytes(4000); // 3000 B/s this interval — EMA pulls the estimate up, not fully
    const speed = h.last().bytesPerSecond!;
    expect(speed).toBeGreaterThan(1000);
    expect(speed).toBeLessThan(3000);
    expect(h.last().etaSeconds).toBeCloseTo(6000 / speed, 1);
  });

  it('isolates a failed file: maps its error, keeps its sent bytes out of the total, moves on', async () => {
    const h = harness([file('bad.mp4', 2000), file('good.mp4', 1000)], {
      errorText: () => 'not a video',
    });
    await Promise.resolve();
    h.inflight[0].onBytes(500);
    h.inflight[0].reject(new Error('415'));
    await Promise.resolve();
    await Promise.resolve();

    expect(h.last().files[0]).toMatchObject({ state: 'failed', error: 'not a video' });
    // The failed file no longer distorts the aggregate: only good.mp4 counts.
    expect(h.last().bytesTotal).toBe(1000);

    expect(h.inflight).toHaveLength(2);
    h.inflight[1].onBytes(1000);
    h.inflight[1].resolve();
    const results = await h.done;
    expect(results.map((r) => r.state)).toEqual(['failed', 'done']);
    expect(h.last().fraction).toBe(1);
  });

  it('cancels one QUEUED file without touching the rest of the batch', async () => {
    const h = harness([file('a.mp4', 1000), file('b.mp4', 1000), file('c.mp4', 1000)]);
    await Promise.resolve();
    h.handle.cancelFile(1); // b is still queued — skipped when its turn comes
    expect(h.last().files[1].state).toBe('cancelled');
    expect(h.last().bytesTotal).toBe(2000); // b's bytes leave the aggregate immediately

    h.inflight[0].onBytes(1000);
    h.inflight[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.inflight).toHaveLength(2);
    expect(h.inflight[1].file.name).toBe('c.mp4'); // b was never started

    h.inflight[1].resolve();
    const results = await h.done;
    expect(results.map((r) => r.state)).toEqual(['done', 'cancelled', 'done']);
  });

  it('cancels the file currently IN FLIGHT by aborting its transport, then continues', async () => {
    const h = harness([file('a.mp4', 1000), file('b.mp4', 1000)]);
    await Promise.resolve();
    h.inflight[0].onBytes(400);
    h.handle.cancelFile(0); // aborts the per-file signal; the transport rejects
    await Promise.resolve();
    await Promise.resolve();

    expect(h.last().files[0].state).toBe('cancelled'); // cancelled, not "failed"
    expect(h.last().bytesTotal).toBe(1000);

    expect(h.inflight).toHaveLength(2);
    h.inflight[1].resolve();
    const results = await h.done;
    expect(results.map((r) => r.state)).toEqual(['cancelled', 'done']);
  });

  it('cancelAll cancels the current file and everything queued, and reports done', async () => {
    const h = harness([file('a.mp4', 1000), file('b.mp4', 1000)]);
    await Promise.resolve();
    h.handle.cancelAll();
    await Promise.resolve();
    await Promise.resolve();
    const results = await h.done;
    expect(results.map((r) => r.state)).toEqual(['cancelled', 'cancelled']);
    expect(h.last().done).toBe(true);
  });
});
