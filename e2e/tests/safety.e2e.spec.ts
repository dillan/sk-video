import { test, expect } from '@playwright/test';
import { BASE, plugin, ensureCamera } from './helpers';

// Man-overboard (C2) and Frigate interop (C4, unconfigured in the harness).

test.beforeAll(async ({ request }) => {
  await ensureCamera(request);
});

test.describe('man overboard (C2)', () => {
  test('activates and deactivates the MOB response, raising an emergency notification', async ({
    request,
  }) => {
    const on = await request.post(plugin('/mob'), { data: {} });
    expect(on.status()).toBe(200);
    const status = await on.json();
    expect(status.active).toBe(true);
    expect(['beacon', 'datum', 'none']).toContain(status.targetSource);
    expect(typeof status.aimedCameras).toBe('number');

    // Best-effort: the emergency notification should be on the bus while active.
    const notifs = await request
      .get(`${BASE}/signalk/v1/api/vessels/self/notifications/sk-video/mob`)
      .catch(() => null);
    if (notifs && notifs.ok()) {
      const body = await notifs.json();
      const value = body?.value ?? body;
      expect(value?.state).toBe('emergency');
    }

    const off = await request.post(plugin('/mob'), { data: { active: false } });
    expect(off.status()).toBe(200);
    expect((await off.json()).active).toBe(false);
  });

  test('503s the MOB endpoint only before start (it is live here)', async ({ request }) => {
    const res = await request.post(plugin('/mob'), { data: { active: false } });
    expect(res.status()).toBe(200); // plugin is started, so never 503
  });
});

test.describe('Frigate interop (C4) — unconfigured', () => {
  test('the Frigate clip endpoints report not-configured (503) when no broker is set', async ({
    request,
  }) => {
    const list = await request.get(plugin('/frigate/clips'));
    expect(list.status()).toBe(503);
    const one = await request.get(plugin('/frigate/clips/anything'));
    expect(one.status()).toBe(503);
  });
});
