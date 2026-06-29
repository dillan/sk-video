import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveApiBase, fetchStatus } from './api';

describe('deriveApiBase', () => {
  it('derives the plugin API base from the app mount path', () => {
    expect(deriveApiBase('/plugins/sk-video/app/')).toBe('/plugins/sk-video');
    expect(deriveApiBase('/plugins/sk-video/app/index.html')).toBe('/plugins/sk-video');
    expect(deriveApiBase('/plugins/sk-video/app')).toBe('/plugins/sk-video');
  });

  it('stays mount-relative when the server hosts the plugin under a different prefix', () => {
    expect(deriveApiBase('/some/proxy/plugins/sk-video/app/')).toBe('/some/proxy/plugins/sk-video');
  });

  it('falls back to the conventional base when not served under /app', () => {
    expect(deriveApiBase('/somewhere/else')).toBe('/plugins/sk-video');
  });
});

describe('fetchStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the parsed status on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true, cameras: 3 }) }),
    );
    await expect(fetchStatus()).resolves.toEqual({ ready: true, cameras: 3 });
  });

  it('throws with the HTTP status when the request is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchStatus()).rejects.toThrow('status 503');
  });
});
