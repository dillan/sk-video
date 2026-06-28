import { test, expect } from '@playwright/test';
import { BASE, plugin, ensureCamera, getPluginConfig, setPluginConfig, pollJson } from './helpers';

// Experimental visual MOB refine (A1). It is OFF by default and only runs when Frigate is configured
// AND the operator opts in. Its SAFETY-CRITICAL behaviour is failing safe: when detections stall it
// raises a Signal K notification and reverts to position-based aim, never silently taking the camera.
//
// This spec drives that fail-safe end-to-end: it enables the experimental toggle with a DEAD Frigate
// URL (so no detections ever arrive), activates MOB, and asserts the "tracking lost" notification
// appears within the loss timeout, then clears on deactivate. It mutates the shared plugin config and
// restores it afterwards, so the suite runs serially (workers: 1).
test.describe.configure({ mode: 'serial' });

const LOST = `${BASE}/signalk/v1/api/vessels/self/notifications/sk-video/mob/visualRefine/lost`;

let original: Record<string, unknown> = { hardwareTier: 'x86' };

test.beforeAll(async ({ request }) => {
  await ensureCamera(request);
  original = (await getPluginConfig(request)).configuration ?? { hardwareTier: 'x86' };
  // Enable the experimental refine with a dead Frigate broker: the refine engages on MOB but no
  // detection ever arrives, so the loss timer must fire and revert to position-based aim.
  await setPluginConfig(request, {
    ...original,
    frigateMqttUrl: 'mqtt://127.0.0.1:1',
    mobVisualRefine: true,
  });
});

test.afterAll(async ({ request }) => {
  await setPluginConfig(request, original);
});

test.describe('visual MOB refine fail-safe (A1)', () => {
  test('raises a "tracking lost" notification when detections stall, then clears on deactivate', async ({
    request,
  }) => {
    const on = await request.post(plugin('/mob'), { data: {} });
    expect(on.status()).toBe(200);
    expect((await on.json()).active).toBe(true);

    try {
      // Within the loss timeout (~4s) + a check tick, the fail-safe notification must appear as alert.
      const lost = await pollJson<{ value?: { state?: string; message?: string } }>(
        request,
        LOST,
        (b) => b.value?.state === 'alert',
        15_000,
      );
      expect(lost, 'a visual-refine "tracking lost" alert should appear').toBeTruthy();
      expect(lost!.value!.message).toMatch(/reverting to position-based aim/i);
    } finally {
      const off = await request.post(plugin('/mob'), { data: { active: false } });
      expect(off.status()).toBe(200);
    }

    // Deactivating MOB tears down the refine and clears the banner (state returns to normal).
    const cleared = await pollJson<{ value?: { state?: string } }>(
      request,
      LOST,
      (b) => b.value?.state === 'normal',
      10_000,
    );
    expect(cleared, 'the fail-safe banner should clear when MOB is deactivated').toBeTruthy();
  });

  test('exposes the experimental toggle as off by default in the plugin schema', async ({
    request,
  }) => {
    // The schema must advertise the option honestly (not safety-rated) and default it OFF.
    // The plugins listing carries the full JSON schema the admin UI renders.
    const list = await (await request.get(`${BASE}/skServer/plugins`)).json();
    const manifest = (list as { id: string; schema?: unknown }[]).find((p) => p.id === 'sk-video');
    expect(manifest).toBeTruthy();
    const schema = manifest!.schema as {
      properties: Record<string, { default?: unknown; title?: string }>;
    };
    const opt = schema.properties.mobVisualRefine;
    expect(opt, 'the experimental refine toggle must be exposed').toBeTruthy();
    expect(opt.default).toBe(false);
    expect(String(opt.title)).toMatch(/not safety-rated/i);
  });
});
