import { describe, it, expect, vi } from 'vitest';
import { fetchFrigateClip, type IFrigateClipFetchDeps } from './frigate-clip-fetch';

/** A Response-like with a real ReadableStream body so the streaming size cap is exercised. */
function res(opts: { ok?: boolean; status?: number; chunks?: number[][]; contentLength?: string }) {
  const chunks = opts.chunks ?? [[1, 2, 3]];
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => (k === 'content-length' ? (opts.contentLength ?? null) : null) },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new Uint8Array(c));
        controller.close();
      },
    }),
    arrayBuffer: async () => new Uint8Array(chunks.flat()).buffer,
  } as unknown as Response;
}

function deps(over: Partial<IFrigateClipFetchDeps> = {}): IFrigateClipFetchDeps {
  return {
    assertHost: async () => undefined,
    fetchImpl: vi.fn().mockResolvedValue(res({ chunks: [[1, 2, 3]] })) as unknown as typeof fetch,
    ...over,
  };
}

describe('fetchFrigateClip', () => {
  it('SSRF-checks the host, refuses redirects, and fetches /api/events/<id>/clip.mp4', async () => {
    const assertHost = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(res({ chunks: [[9, 9]] }));
    const bytes = await fetchFrigateClip('http://192.168.1.10:5000', 'evt.1-a', {
      assertHost,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(assertHost).toHaveBeenCalledWith('192.168.1.10');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://192.168.1.10:5000/api/events/evt.1-a/clip.mp4',
      expect.objectContaining({ redirect: 'error', signal: expect.anything() }),
    );
    expect(Array.from(bytes)).toEqual([9, 9]);
  });

  it('rejects an event id that is not a strict slug, before any fetch (no path escape)', async () => {
    const fetchImpl = vi.fn();
    for (const bad of ['..', '.', '../../etc/passwd', 'a/b', '']) {
      await expect(
        fetchFrigateClip('http://frigate:5000', bad, {
          assertHost: async () => undefined,
          fetchImpl: fetchImpl as never,
        }),
      ).rejects.toThrow(/invalid frigate event id/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) api url and never fetches', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchFrigateClip('file:///etc/passwd', 'e', {
        assertHost: async () => undefined,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toThrow(/http/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propagates an SSRF rejection without fetching', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchFrigateClip('http://169.254.169.254', 'e', {
        assertHost: async () => {
          throw new Error('blocked host');
        },
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toThrow(/blocked/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws on a non-OK response', async () => {
    await expect(
      fetchFrigateClip(
        'http://frigate:5000',
        'e',
        deps({ fetchImpl: vi.fn().mockResolvedValue(res({ ok: false, status: 404 })) as never }),
      ),
    ).rejects.toThrow(/404/);
  });

  it('rejects an over-sized clip by the declared Content-Length fast path', async () => {
    await expect(
      fetchFrigateClip(
        'http://frigate:5000',
        'e',
        deps({
          maxBytes: 2,
          fetchImpl: vi.fn().mockResolvedValue(res({ contentLength: '999' })) as never,
        }),
      ),
    ).rejects.toThrow(/too large/);
  });

  it('caps a streamed body with NO Content-Length before buffering it all (OOM guard)', async () => {
    // Two 10-byte chunks, cap 5: must abort on the first chunk, never reading both.
    await expect(
      fetchFrigateClip(
        'http://frigate:5000',
        'e',
        deps({
          maxBytes: 5,
          fetchImpl: vi.fn().mockResolvedValue(
            res({
              chunks: [
                [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                [1, 1],
              ],
            }),
          ) as never,
        }),
      ),
    ).rejects.toThrow(/too large/);
  });
});
