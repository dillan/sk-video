import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveApiBase, describeAuth, fetchStatus, fetchSession, fetchMobStatus } from './api';

describe('describeAuth', () => {
  it('describes the auth posture for the header chip', () => {
    expect(describeAuth(null)).toBe('checking…');
    expect(describeAuth({ securityEnabled: false, authenticated: true, pluginVersion: '1' })).toBe(
      'open server',
    );
    expect(describeAuth({ securityEnabled: true, authenticated: true, pluginVersion: '1' })).toBe(
      'secured · signed in',
    );
    expect(describeAuth({ securityEnabled: true, authenticated: false, pluginVersion: '1' })).toBe(
      'secured · sign in required',
    );
  });
});

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

describe('fetchSession', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the parsed session info on success', async () => {
    const info = { securityEnabled: true, authenticated: false, pluginVersion: '1.1.0' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => info }));
    await expect(fetchSession()).resolves.toEqual(info);
  });

  it('throws when the session request is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchSession()).rejects.toThrow('session 500');
  });
});

describe('fetchMobStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the parsed MOB status', async () => {
    const status = { active: true, targetSource: 'datum', aimedCameras: 3 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => status }));
    await expect(fetchMobStatus()).resolves.toEqual(status);
  });

  it('throws when the request is not ok (e.g. 503 before start)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchMobStatus()).rejects.toThrow('mob 503');
  });
});
