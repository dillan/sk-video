import { test, expect } from '@playwright/test';
import { plugin, CAMERA, ensureCamera, waitForStatus, pollJson } from './helpers';

// DVR recording (C10), stream health (F6) and the substream variant route (C6.2). The harness sets
// hardwareTier=x86 so recording channels are available; the recorder reads go2rtc's loopback RTSP.

test.beforeAll(async ({ request }) => {
  await ensureCamera(request);
  // Warm go2rtc so the camera has a live producer the recorder can read from.
  await waitForStatus(request, plugin(`/cameras/${CAMERA}/stream.m3u8`), 200).catch(
    () => undefined,
  );
});

test.describe('DVR recording (C10)', () => {
  test('records a camera, lists + Range-serves the segment, then stops', async ({ request }) => {
    const start = await request.post(plugin(`/cameras/${CAMERA}/record`), {
      data: { active: true },
    });
    expect(start.status(), await start.text()).toBe(200);
    expect((await start.json()).recording).toBe(true);

    try {
      // The segment file appears as ffmpeg opens it; poll the listing until our camera shows up.
      const listing = await pollJson<{
        recording: string[];
        segments: { camera: string; name: string }[];
      }>(
        request,
        plugin('/recordings'),
        (b) => b.segments.some((s) => s.camera === CAMERA),
        40_000,
      );
      expect(listing, 'a recording segment should appear').toBeTruthy();
      expect(listing!.recording).toContain(CAMERA);

      const segment = listing!.segments.find((s) => s.camera === CAMERA)!;
      expect(segment.name).toMatch(/^testcam_\d{8}_\d{6}\.mp4$/);

      const ranged = await request.get(plugin(`/recordings/${segment.name}`), {
        headers: { Range: 'bytes=0-15' },
      });
      expect(ranged.status()).toBe(206);
      expect(ranged.headers()['content-type']).toBe('video/mp4');
      expect(ranged.headers()['content-range']).toMatch(/^bytes 0-15\//);
    } finally {
      const stop = await request.post(plugin(`/cameras/${CAMERA}/record`), {
        data: { active: false },
      });
      expect((await stop.json()).recording).toBe(false);
    }
  });

  test('rejects a traversal segment name (400) and an unknown camera (404)', async ({
    request,
  }) => {
    const bad = await request.get(plugin('/recordings/..%2f..%2fetc%2fpasswd'));
    expect(bad.status()).toBe(400);
    const unknown = await request.post(plugin('/cameras/no-such-cam/record'), {
      data: { active: true },
    });
    expect(unknown.status()).toBe(404);
  });
});

test.describe('stream health (F6)', () => {
  test('reports a minimal health DTO with redacted sources', async ({ request }) => {
    const res = await request.get(plugin(`/cameras/${CAMERA}/health`));
    expect([200, 502]).toContain(res.status()); // 502 only if go2rtc is momentarily unreachable
    if (res.status() === 200) {
      const body = await res.json();
      expect(typeof body.online).toBe('boolean');
      expect(Array.isArray(body.codecs)).toBe(true);
      expect(Array.isArray(body.sources)).toBe(true);
      // No credentials are configured on testcam, but assert the source never carries a userinfo '@'.
      expect((body.sources as string[]).every((s) => !/:\/\/[^/]*@/.test(s))).toBe(true);
    }
  });
});

test.describe('substream variant (C6.2)', () => {
  test('404s whep ?variant=sub when the camera has no substream', async ({ request }) => {
    const res = await request.post(plugin(`/cameras/${CAMERA}/whep?variant=sub`), { data: 'v=0' });
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toMatch(/no substream/);
  });
});
