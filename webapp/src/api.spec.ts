import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  deriveApiBase,
  describeAuth,
  fetchStatus,
  fetchSession,
  fetchMobStatus,
  login,
  logout,
  ptzNudge,
  ptzAim,
  saveCamera,
  deleteCamera,
  negotiateTalk,
  uploadVideo,
  setAuthObserver,
  ApiError,
} from './api';

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
    expect(
      describeAuth({
        securityEnabled: true,
        authenticated: true,
        readOnly: true,
        pluginVersion: '1',
      }),
    ).toBe('secured · read-only');
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

  it('uses the conventional base when mounted as a listed webapp at /sk-video/', () => {
    // signalk-server serves the signalk-webapp at /<name>/; the API still lives at /plugins/sk-video
    // same-origin, so the fallback is exactly right there.
    expect(deriveApiBase('/sk-video/')).toBe('/plugins/sk-video');
    expect(deriveApiBase('/sk-video/index.html')).toBe('/plugins/sk-video');
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

  it('throws when the session request is a 5xx (unreachable, not a sign-in prompt)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchSession()).rejects.toThrow('session 500');
  });

  it('maps a 401 to secured + not authenticated (never strands the shell on "checking")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchSession()).resolves.toMatchObject({
      securityEnabled: true,
      authenticated: false,
      loggedIn: false,
      canWrite: false,
    });
  });
});

describe('auth-failure observer (the centralized 401/403 seam)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAuthObserver(null);
  });

  function record(): { status: number; method: string; url: string }[] {
    const signals: { status: number; method: string; url: string }[] = [];
    setAuthObserver((s) => signals.push(s));
    return signals;
  }

  const jsonErr = (status: number) => ({
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    json: async () => ({}),
  });

  it('fires on a 401 from a read (getJson-based call)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const signals = record();
    await fetchStatus().catch(() => undefined);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ status: 401, method: 'GET' });
  });

  it('fires on a 403 from a write (send-based control)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonErr(403)));
    const signals = record();
    await ptzNudge('cam1', { pan: 0.1 }).catch(() => undefined);
    expect(signals.map((s) => s.status)).toContain(403);
  });

  it('fires on a 401 from the camera-resource bypasser (saveCamera → /signalk/v2)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const signals = record();
    await saveCamera('cam1', {
      name: 'Bow',
      enabled: true,
      source: { scheme: 'rtsp', host: 'x' },
    }).catch(() => undefined);
    expect(signals.map((s) => s.status)).toContain(401);
  });

  it('fires on a 401 from deleteCamera', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const signals = record();
    await deleteCamera('cam1').catch(() => undefined);
    expect(signals).toHaveLength(1);
  });

  it('fires on a 401 from negotiateTalk (direct fetch bypasser)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, headers: { get: () => 'text/plain' } }),
    );
    const signals = record();
    await negotiateTalk('cam1', 'sdp').catch(() => undefined);
    expect(signals.map((s) => s.status)).toContain(401);
  });

  it('fires on a 401 from uploadVideo (XHR bypasser)', async () => {
    const signals = record();
    class MockXHR {
      status = 401;
      response = {};
      upload: Record<string, unknown> = {};
      withCredentials = false;
      responseType = '';
      onload?: () => void;
      open(): void {}
      setRequestHeader(): void {}
      addEventListener(): void {}
      send(): void {
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockXHR as unknown as typeof XMLHttpRequest);
    await uploadVideo(new File(['x'], 'v.mp4')).catch(() => undefined);
    expect(signals.map((s) => s.status)).toContain(401);
  });

  it('does NOT fire for a login 401 (a form error, never a session challenge)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const signals = record();
    await login('a', 'b').catch(() => undefined);
    expect(signals).toHaveLength(0);
  });

  it('does NOT fire for a logout 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const signals = record();
    await logout().catch(() => undefined);
    expect(signals).toHaveLength(0);
  });

  it('does NOT fire on success or a 5xx', async () => {
    const signals = record();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }),
    );
    await fetchStatus().catch(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await fetchStatus().catch(() => undefined);
    expect(signals).toHaveLength(0);
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

describe('login / logout (delegated to Signal K auth)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs credentials to the Signal K login endpoint with cookies included', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);
    await login('pilot', 'secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/signalk/v1/auth/login');
    expect(opts).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(opts.body as string)).toEqual({ username: 'pilot', password: 'secret' });
  });

  it('reports a friendly message on bad credentials (401)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(login('pilot', 'nope')).rejects.toThrow('Incorrect username or password.');
  });

  it('surfaces other failures with the status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(login('pilot', 'secret')).rejects.toThrow('Sign-in failed (500).');
  });

  it('logout PUTs to the Signal K logout endpoint with cookies included', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await logout();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/signalk/v1/auth/logout');
    expect(opts).toMatchObject({ method: 'PUT', credentials: 'include' });
  });
});

describe('ptzAim (tap-to-aim)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs the {dx,dy} offset to the aim route and returns the parsed outcome', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ outcome: 'aimed', kind: 'absolute' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await ptzAim('front-deck', 0.2, -0.1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/cameras/front-deck/ptz/aim');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ dx: 0.2, dy: -0.1 });
    expect(result).toEqual({ outcome: 'aimed', kind: 'absolute' });
  });

  it('throws an ApiError when the aim is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 501,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'camera does not support PTZ' }),
      }),
    );
    const err = await ptzAim('cam1', 0.1, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 501 });
  });
});

describe('ApiError carries the server’s actionable failure detail', () => {
  afterEach(() => vi.restoreAllMocks());

  it('captures the hint + reason from a 502 ONVIF error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Enable ONVIF on the camera.', reason: 'onvif' }),
      }),
    );
    const err = await ptzNudge('cam1', { pan: 0.1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 502,
      hint: 'Enable ONVIF on the camera.',
      reason: 'onvif',
    });
  });

  it('degrades gracefully when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => 'text/plain' },
      }),
    );
    const err = (await ptzNudge('cam1', { pan: 0.1 }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.hint).toBeUndefined();
    expect(err.reason).toBeUndefined();
  });
});
