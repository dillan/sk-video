import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE = process.env.SIGNALK_URL || 'http://localhost:3000';
const CAMERA = 'testcam';

/** A minimal valid MP4 (ftyp + isom brand) padded, so the plugin accepts the upload by magic bytes. */
function tinyMp4(size = 4096): Buffer {
  const head = Buffer.from([0, 0, 0, 0x20, ...Buffer.from('ftypisom')]);
  return Buffer.concat([head, Buffer.alloc(size - head.length, 7)]);
}

/** Polls an endpoint until it returns 200 (go2rtc needs a few seconds to warm up the HLS muxer). */
async function waitFor200(
  request: APIRequestContext,
  url: string,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    const res = await request.get(url).catch(() => null);
    last = res?.status() ?? 0;
    if (last === 200) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for 200 from ${url} (last status ${last})`);
}

test.beforeAll(async ({ request }) => {
  // Ensure the camera resource exists (idempotent — the harness seed may already have run).
  await request
    .put(`${BASE}/signalk/v2/api/resources/cameras/${CAMERA}`, {
      data: {
        name: 'Test Camera',
        enabled: true,
        source: { scheme: 'rtsp', host: 'mediamtx', port: 8554, path: '/cam' },
      },
    })
    .catch(() => undefined);
});

test.describe('sk-video plugin live contract', () => {
  test('reports ready status', async ({ request }) => {
    const res = await request.get(`${BASE}/plugins/sk-video/status`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ready).toBe(true);
  });

  test('serves the camera as browser HLS through the gateway', async ({ request }) => {
    const url = `${BASE}/plugins/sk-video/cameras/${CAMERA}/stream.m3u8`;
    await waitFor200(request, url);
    const res = await request.get(url);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('#EXTM3U');
  });

  test('returns a JPEG snapshot frame', async ({ request }) => {
    const url = `${BASE}/plugins/sk-video/cameras/${CAMERA}/frame.jpeg`;
    // go2rtc transcodes the frame with ffmpeg; poll until a non-empty JPEG comes back.
    const deadline = Date.now() + 45_000;
    let body = Buffer.alloc(0);
    while (Date.now() < deadline) {
      const res = await request.get(url).catch(() => null);
      if (res?.status() === 200) {
        body = Buffer.from(await res.body());
        if (body.length > 0) break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toBe(0xff); // JPEG SOI
    expect(body[1]).toBe(0xd8);
  });

  test('discovery endpoint responds (candidates depend on multicast)', async ({ request }) => {
    const res = await request.get(`${BASE}/plugins/sk-video/cameras/discover`);
    // 200 with an array, or 429 if a scan is already in flight — both are valid.
    expect([200, 429]).toContain(res.status());
    if (res.status() === 200) {
      expect(Array.isArray((await res.json()).cameras)).toBe(true);
    }
  });

  test('uploads a video and serves it back with HTTP Range', async ({ request }) => {
    const upload = await request.post(`${BASE}/plugins/sk-video/videos`, {
      headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'e2e-clip.mp4' },
      data: tinyMp4(),
    });
    expect(upload.status()).toBe(201);
    const asset = await upload.json();
    expect(asset.contentType).toBe('video/mp4');

    const list = await request.get(`${BASE}/plugins/sk-video/videos`);
    expect((await list.json()).videos.some((v: { id: string }) => v.id === asset.id)).toBe(true);

    const ranged = await request.get(`${BASE}/plugins/sk-video/videos/${asset.id}`, {
      headers: { Range: 'bytes=0-9' },
    });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()['content-range']).toMatch(/^bytes 0-9\//);

    // Clean up so reruns stay deterministic.
    await request.delete(`${BASE}/plugins/sk-video/videos/${asset.id}`);
  });

  test('stores write-only camera credentials and never returns them', async ({ request }) => {
    const secret = 'sup3r-s3cret-pw';
    const post = await request.post(`${BASE}/plugins/sk-video/cameras/${CAMERA}/credentials`, {
      data: { username: 'cam-admin', password: secret },
    });
    expect(post.status()).toBe(204);

    // The shared cameras resource must never echo the secret back to clients.
    const cam = await request.get(`${BASE}/signalk/v2/api/resources/cameras/${CAMERA}`);
    expect(cam.ok()).toBeTruthy();
    expect(await cam.text()).not.toContain(secret);

    // Delete returns 204 the first time and 404 once the credentials are gone.
    const first = await request.delete(`${BASE}/plugins/sk-video/cameras/${CAMERA}/credentials`);
    expect(first.status()).toBe(204);
    const second = await request.delete(`${BASE}/plugins/sk-video/cameras/${CAMERA}/credentials`);
    expect(second.status()).toBe(404);
  });

  test('deleting a camera also clears its stored credentials', async ({ request }) => {
    const id = 'cleanup-cam';
    await request.put(`${BASE}/signalk/v2/api/resources/cameras/${id}`, {
      data: { name: 'Cleanup', enabled: false, source: { scheme: 'rtsp', host: 'mediamtx' } },
    });
    const post = await request.post(`${BASE}/plugins/sk-video/cameras/${id}/credentials`, {
      data: { username: 'u', password: 'temp-secret' },
    });
    expect(post.status()).toBe(204);

    // Removing the camera resource must also drop its credentials server-side.
    await request.delete(`${BASE}/signalk/v2/api/resources/cameras/${id}`);

    // If the credentials were cleared with the camera, a delete now finds nothing (404).
    const after = await request.delete(`${BASE}/plugins/sk-video/cameras/${id}/credentials`);
    expect(after.status()).toBe(404);
  });

  test('proxies the HLS sub-resources referenced by the master playlist', async ({ request }) => {
    const masterUrl = `${BASE}/plugins/sk-video/cameras/${CAMERA}/stream.m3u8`;
    await waitFor200(request, masterUrl);
    const master = await (await request.get(masterUrl)).text();
    // The master references sub-resources with RELATIVE urls (e.g. "hls/playlist.m3u8?id=..."), which
    // resolve back through the /cameras/:id/hls/:resource proxy route. Fetching one exercises that route
    // end to end (the segment-proxy path that makes live playback work).
    const ref = master
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#'));
    expect(ref, 'master playlist should reference a relative sub-resource').toBeTruthy();
    const subUrl = `${BASE}/plugins/sk-video/cameras/${CAMERA}/${ref}`;
    await waitFor200(request, subUrl);
    const sub = await request.get(subUrl);
    expect(sub.status()).toBe(200);
    expect((await sub.body()).length).toBeGreaterThan(0);
  });

  test('rejects a non-video upload by magic bytes (415)', async ({ request }) => {
    const res = await request.post(`${BASE}/plugins/sk-video/videos`, {
      headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'evil.mp4' },
      data: Buffer.from('<!doctype html><html>not a video</html>'),
    });
    expect(res.status()).toBe(415);
  });

  test('returns 416 for an unsatisfiable Range', async ({ request }) => {
    const up = await request.post(`${BASE}/plugins/sk-video/videos`, {
      headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'range.mp4' },
      data: tinyMp4(2048),
    });
    const { id } = await up.json();
    const res = await request.get(`${BASE}/plugins/sk-video/videos/${id}`, {
      headers: { Range: 'bytes=999999-1000000' },
    });
    expect(res.status()).toBe(416);
    await request.delete(`${BASE}/plugins/sk-video/videos/${id}`);
  });

  test('returns 404 for an unknown camera on the gateway proxy', async ({ request }) => {
    const unknown = 'no-such-camera';
    for (const path of ['stream.m3u8', 'frame.jpeg']) {
      const res = await request.get(`${BASE}/plugins/sk-video/cameras/${unknown}/${path}`);
      expect(res.status()).toBe(404);
    }
    const whep = await request.post(`${BASE}/plugins/sk-video/cameras/${unknown}/whep`, {
      data: 'v=0',
    });
    expect(whep.status()).toBe(404);
  });
});

test.describe('KIP webapp', () => {
  test('loads the KIP shell (skipped if KIP is not built/mounted)', async ({ page }) => {
    const res = await page.goto('/@mxtommy/kip').catch(() => null);
    test.skip(!res || !res.ok(), 'KIP webapp not mounted (set KIP_PATH and rebuild the stack)');
    const hasApp = await page
      .locator('app-root')
      .count()
      .catch(() => 0);
    test.skip(hasApp === 0, 'KIP not built — run ./run.sh to build the webapp');
    await expect(page.locator('app-root')).toBeAttached();
  });
});
