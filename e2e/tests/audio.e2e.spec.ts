import { test, expect } from '@playwright/test';
import { plugin, resource, CAMERA, ensureCamera } from './helpers';

// Camera-native two-way audio backchannel (A4): a same-origin /talk route that proxies the browser's
// WebRTC offer to go2rtc's NATIVE backchannel (not WHIP), gated on the camera reporting an audio
// output. The harness can't exercise a real speaker, but it pins the capability gate + same-origin
// proxy behaviour.

test.beforeAll(async ({ request }) => {
  await ensureCamera(request);
});

test.describe('two-way audio backchannel (A4)', () => {
  test('404s talk on a camera with no audio backchannel capability', async ({ request }) => {
    // testcam has no capabilities.audioBackchannel, so the gate rejects it before touching go2rtc.
    const res = await request.post(plugin(`/cameras/${CAMERA}/talk`), { data: 'v=0\r\n' });
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toMatch(/no two-way audio backchannel/);
  });

  test('404s talk on an unknown camera', async ({ request }) => {
    const res = await request.post(plugin('/cameras/no-such-cam/talk'), { data: 'v=0\r\n' });
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toMatch(/unknown camera/);
  });

  test('a camera reporting an audio output passes the gate and reaches the gateway', async ({
    request,
  }) => {
    const id = 'talkcam';
    await request.put(resource(id), {
      data: {
        name: 'Hailing Camera',
        enabled: true,
        source: { scheme: 'rtsp', host: 'mediamtx', port: 8554, path: '/cam' },
        capabilities: { audioBackchannel: true },
      },
    });
    try {
      // The resource must NOT echo any credential, but it should carry the capability flag back.
      const cam = await (await request.get(resource(id))).json();
      expect(cam.capabilities?.audioBackchannel).toBe(true);

      // With the gate passed, the proxy forwards our (deliberately minimal) offer to go2rtc. go2rtc
      // rejects the junk SDP (and may 404 an unwarmed stream), so the status alone can't tell the
      // gate apart from the gateway. The contract is the BODY: the route never answers with its own
      // gate rejections ("no backchannel" / "unknown camera") for a known, backchannel-capable camera.
      const res = await request.post(plugin(`/cameras/${id}/talk`), { data: 'v=0\r\n' });
      const text = await res.text();
      expect(text).not.toMatch(/no two-way audio backchannel/);
      expect(text).not.toMatch(/unknown camera/);
    } finally {
      await request.delete(resource(id));
    }
  });
});
