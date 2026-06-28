import { describe, it, expect, vi } from 'vitest';
import { fetchFrigateClip, type IFrigateClipFetchDeps } from './frigate-clip-fetch';

function res(opts: { ok?: boolean; status?: number; bytes?: number[]; contentLength?: string }) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => (k === 'content-length' ? (opts.contentLength ?? null) : null) },
    arrayBuffer: async () => new Uint8Array(opts.bytes ?? [1, 2, 3]).buffer,
  } as unknown as Response;
}

function deps(over: Partial<IFrigateClipFetchDeps> = {}): IFrigateClipFetchDeps {
  return {
    assertHost: async () => undefined,
    fetchImpl: vi.fn().mockResolvedValue(res({ bytes: [1, 2, 3] })) as unknown as typeof fetch,
    ...over,
  };
}

describe('fetchFrigateClip', () => {
  it('SSRF-checks the host and fetches /api/events/<id>/clip.mp4', async () => {
    const assertHost = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(res({ bytes: [9, 9] }));
    const bytes = await fetchFrigateClip('http://192.168.1.10:5000', 'evt.1-a', {
      assertHost,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(assertHost).toHaveBeenCalledWith('192.168.1.10');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://192.168.1.10:5000/api/events/evt.1-a/clip.mp4',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(Array.from(bytes)).toEqual([9, 9]);
  });

  it('url-encodes a hostile event id so it cannot escape the clip path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({}));
    await fetchFrigateClip('http://frigate:5000', '../../etc/passwd', {
      assertHost: async () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const called = fetchImpl.mock.calls[0][0] as string;
    expect(called).toContain('/api/events/..%2F..%2Fetc%2Fpasswd/clip.mp4');
    expect(called).not.toContain('/etc/passwd');
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

  it('rejects an over-sized clip by declared Content-Length and by actual bytes', async () => {
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
    await expect(
      fetchFrigateClip(
        'http://frigate:5000',
        'e',
        deps({
          maxBytes: 2,
          fetchImpl: vi.fn().mockResolvedValue(res({ bytes: [1, 2, 3, 4] })) as never, // no content-length, 4 bytes
        }),
      ),
    ).rejects.toThrow(/too large/);
  });
});
