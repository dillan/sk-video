import { test, expect } from '@playwright/test';
import { plugin, CAMERA, ensureCamera, waitForStatus } from './helpers';

// Adaptive transport contract (A5): the server-side hints the widget walks (WebRTC -> HLS -> MJPEG)
// plus the frame-loop-friendly Cache-Control on the still-refresh fallback. The walk UX itself is KIP.

test.beforeAll(async ({ request }) => {
  await ensureCamera(request);
  // Warm go2rtc so health introspection has a live producer to report on.
  await waitForStatus(request, plugin(`/cameras/${CAMERA}/stream.m3u8`), 200).catch(
    () => undefined,
  );
});

test.describe('transport contract (A5)', () => {
  test('serves a recommended transport walk with codecs + online flag', async ({ request }) => {
    const res = await request.get(plugin(`/cameras/${CAMERA}/transport`));
    expect([200, 502]).toContain(res.status()); // 502 only if go2rtc is momentarily unreachable
    if (res.status() === 200) {
      const body = await res.json();
      // The walk is a non-empty ordering drawn only from the three known transports.
      expect(Array.isArray(body.recommended)).toBe(true);
      expect(body.recommended.length).toBeGreaterThan(0);
      for (const t of body.recommended as string[]) {
        expect(['webrtc', 'hls', 'mjpeg']).toContain(t);
      }
      expect(Array.isArray(body.codecs)).toBe(true);
      expect(typeof body.online).toBe('boolean');
      expect(typeof body.note).toBe('string');
      // No credentialed source URL escapes through the hints DTO.
      expect(JSON.stringify(body)).not.toMatch(/:\/\/[^/"]*@/);
    }
  });

  test('404s an unknown camera', async ({ request }) => {
    const res = await request.get(plugin('/cameras/no-such-cam/transport'));
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toMatch(/unknown camera/);
  });

  test('the still-frame fallback is served no-store so the MJPEG loop never caches', async ({
    request,
  }) => {
    const res = await request.get(plugin(`/cameras/${CAMERA}/frame.jpeg`));
    expect([200, 502]).toContain(res.status());
    if (res.status() === 200) {
      expect(res.headers()['cache-control']).toBe('no-store');
    }
  });
});
