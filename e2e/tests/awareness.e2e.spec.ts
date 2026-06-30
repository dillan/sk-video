import { test, expect } from '@playwright/test';
import { BASE, plugin, resource, CAMERA, ensureCamera } from './helpers';

// Layout hints (C7), 360 projection (A2), onboarding hints (A3), slew-to-cue (C8) and imaging (C5).

test.beforeAll(async ({ request }) => {
  await ensureCamera(request);
});

test.describe('layout hints (C7) + 360 projection (A2)', () => {
  test('serves structured layout hints including the test camera', async ({ request }) => {
    const res = await request.get(plugin('/cameras/layout'));
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.cameras)).toBe(true);
    expect(body.byRole).toBeTruthy();
    expect(body.bySector).toBeTruthy();
    expect(body.suggestedGrid).toMatchObject({
      rows: expect.any(Number),
      cols: expect.any(Number),
    });
    expect((body.cameras as { id: string }[]).some((c) => c.id === CAMERA)).toBe(true);
  });

  test('a media.projection=equirectangular camera is flagged panoramic in the layout', async ({
    request,
  }) => {
    const id = 'mast360';
    await request.put(resource(id), {
      data: {
        name: 'Masthead 360',
        enabled: false, // disabled so it never tries to warm go2rtc
        source: { scheme: 'rtsp', host: '192.168.1.77', port: 8554, path: '/live' },
        placement: { mount: 'mast' },
        media: { projection: 'equirectangular' },
      },
    });
    try {
      // The resource echoes the projection back (no credentials, no server-side dewarp).
      const cam = await request.get(resource(id));
      expect((await cam.json()).media.projection).toBe('equirectangular');

      // Layout excludes disabled cameras, so enable it briefly to assert the panoramic flag.
      await request.put(resource(id), {
        data: {
          name: 'Masthead 360',
          enabled: true,
          source: { scheme: 'rtsp', host: '192.168.1.77', port: 8554, path: '/live' },
          placement: { mount: 'mast' },
          media: { projection: 'equirectangular' },
        },
      });
      const layout = await (await request.get(plugin('/cameras/layout'))).json();
      const entry = (
        layout.cameras as { id: string; panoramic: boolean; projection: string }[]
      ).find((c) => c.id === id);
      expect(entry).toMatchObject({ projection: 'equirectangular', panoramic: true });
      expect((layout.groups as { key: string }[]).some((g) => g.key === 'panoramic')).toBe(true);
    } finally {
      await request.delete(resource(id));
    }
  });

  test('rejects an unknown projection on the cameras resource', async ({ request }) => {
    const res = await request.put(resource('bad360'), {
      data: {
        name: 'Bad',
        enabled: false,
        source: { scheme: 'rtsp', host: 'h' },
        media: { projection: 'flat' },
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe('onboarding hints (A3)', () => {
  test('serves curated GoPro + Insta360 presets with honest caveats', async ({ request }) => {
    const res = await request.get(plugin('/cameras/onboarding-hints'));
    expect(res.status()).toBe(200);
    const hints = (await res.json()).hints as {
      key: string;
      sources: unknown[];
      caveats: string[];
    }[];
    const keys = hints.map((h) => h.key);
    expect(keys).toContain('gopro-hero');
    expect(keys).toContain('insta360-x');
    expect(hints.every((h) => h.caveats.length > 0)).toBe(true);
  });
});

test.describe('AIS slew-to-cue (C8)', () => {
  test('refuses to slew an uncalibrated / non-PTZ camera, and 404s an unknown one', async ({
    request,
  }) => {
    const res = await request.post(plugin(`/cameras/${CAMERA}/slew-to-cue`));
    // testcam has no absolute PTZ and no calibration -> 409 (and 404 if no own-ship/target before that).
    expect([404, 409]).toContain(res.status());
    const unknown = await request.post(plugin('/cameras/no-such-cam/slew-to-cue'));
    expect(unknown.status()).toBe(404);
  });
});

test.describe('imaging presets (C5)', () => {
  test('GET imaging on an RTSP-only camera fails through to the controller (502, redacted)', async ({
    request,
  }) => {
    // testcam is plain RTSP (no ONVIF), so the imaging controller cannot connect -> 502. With the
    // --onvif profile + an ONVIF-backed camera this returns 200 with settings/presets instead.
    const res = await request.get(plugin(`/cameras/${CAMERA}/imaging`));
    expect([200, 502]).toContain(res.status());
    if (res.status() === 502) {
      expect(JSON.stringify(await res.json())).not.toMatch(/:\/\/[^/]*@/); // no credentials leak
    }
  });

  test('400s an unknown imaging preset (validated before the controller is touched)', async ({
    request,
  }) => {
    const res = await request.post(plugin(`/cameras/${CAMERA}/imaging/preset`), {
      data: { preset: 'disco' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/unknown imaging preset/);
  });
});

test.describe('plugin status carries the hardware tier', () => {
  test('status reports ready + a tier', async ({ request }) => {
    const res = await request.get(plugin('/status'));
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(body.hardware?.tier).toBe('x86'); // set in the harness plugin config
    // The Signal K base is reachable (sanity for the resource-backed tests).
    expect(BASE).toMatch(/^https?:\/\//);
  });
});
