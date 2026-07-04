import { describe, it, expect, vi } from 'vitest';
import { resumableUpload, type IUploadWire } from './resumable-upload';
import { ApiError } from '../api';

const FILE = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4' });

/** A scriptable wire: each append call consumes the next behavior from the plan. */
function fakeWire(plan: Array<'ok' | 'drop' | ApiError>, opts: { offsetAfterDrop?: number } = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  let offset = 0;
  const wire: IUploadWire = {
    async create(file) {
      calls.push({ method: 'create', args: [file.name, file.size] });
      return { id: 'u1', offset: 0 };
    },
    async append(id, _file, from, onBytes) {
      calls.push({ method: 'append', args: [id, from] });
      const behavior = plan.shift() ?? 'ok';
      if (behavior === 'ok') {
        onBytes(FILE.size);
        offset = FILE.size;
        return;
      }
      if (behavior === 'drop') {
        onBytes(opts.offsetAfterDrop ?? 60);
        offset = opts.offsetAfterDrop ?? 60;
        throw new ApiError('upload failed (network)', 0);
      }
      throw behavior;
    },
    async probe(id) {
      calls.push({ method: 'probe', args: [id] });
      return { offset };
    },
    async complete(id) {
      calls.push({ method: 'complete', args: [id] });
      return { id: 'v1', name: 'clip.mp4' };
    },
    async discard(id) {
      calls.push({ method: 'discard', args: [id] });
    },
  };
  return { wire, calls };
}

const fast = { sleep: async () => {}, backoffMs: () => 0 };

describe('resumableUpload', () => {
  it('creates a session, streams the file, and completes', async () => {
    const { wire, calls } = fakeWire(['ok']);
    const sent: number[] = [];
    const asset = await resumableUpload(FILE, wire, { ...fast, onBytes: (b) => sent.push(b) });
    expect((asset as { id: string }).id).toBe('v1');
    expect(calls.map((c) => c.method)).toEqual(['create', 'append', 'complete']);
    expect(sent).toContain(100);
  });

  it('resumes from the server-reported offset after a dropped connection', async () => {
    const { wire, calls } = fakeWire(['drop', 'ok'], { offsetAfterDrop: 60 });
    await resumableUpload(FILE, wire, fast);
    const appends = calls.filter((c) => c.method === 'append').map((c) => c.args[1]);
    expect(appends).toEqual([0, 60]); // the retry resumed, it did not restart
    expect(calls.map((c) => c.method)).toContain('probe');
  });

  it('treats a 409 offset conflict as the resume signal, not a failure', async () => {
    // e.g. a duplicated chunk after a flaky proxy: the server refuses with the real offset.
    const { wire, calls } = fakeWire([new ApiError('upload failed (409)', 409), 'ok']);
    await resumableUpload(FILE, wire, fast);
    expect(calls.map((c) => c.method)).toContain('probe');
    expect(calls.map((c) => c.method)).toContain('complete');
  });

  it('does not retry a permanent rejection (4xx) and discards the session', async () => {
    const { wire, calls } = fakeWire([new ApiError('upload failed (415)', 415)]);
    await expect(resumableUpload(FILE, wire, fast)).rejects.toMatchObject({ status: 415 });
    expect(calls.filter((c) => c.method === 'append')).toHaveLength(1); // no second try
    expect(calls.map((c) => c.method)).toContain('discard');
  });

  it('gives up after the retry budget and discards, backing off between tries', async () => {
    const { wire, calls } = fakeWire(['drop', 'drop', 'drop', 'drop']);
    const sleeps: number[] = [];
    await expect(
      resumableUpload(FILE, wire, {
        attempts: 3,
        backoffMs: (attempt) => attempt * 100,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toBeTruthy();
    expect(calls.filter((c) => c.method === 'append')).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]); // backs off between attempts, not after the last
    expect(calls.map((c) => c.method)).toContain('discard');
  });

  it('cancels without retrying and discards the session', async () => {
    const ctrl = new AbortController();
    const { wire, calls } = fakeWire([]);
    wire.append = vi.fn(async () => {
      ctrl.abort();
      throw new ApiError('upload cancelled', 0);
    });
    await expect(
      resumableUpload(FILE, wire, { ...fast, signal: ctrl.signal }),
    ).rejects.toBeTruthy();
    expect(calls.filter((c) => c.method === 'probe')).toHaveLength(0); // no resume attempt
    expect(calls.map((c) => c.method)).toContain('discard');
  });
});
