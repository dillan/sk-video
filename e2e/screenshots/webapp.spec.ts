import { test, expect, type APIRequestContext } from '@playwright/test';
import { shot } from './kip-harness';

// KIP-INDEPENDENT captures of the SK Video web app console (the React PWA the plugin serves at
// /plugins/sk-video/app/ and lists at /sk-video/). Like admin.spec.ts these only need the core stack
// (Signal K + the plugin + the MediaMTX test camera) — no KIP. They reset to a clean, realistic camera
// set so the Live Wall and Review screens look the same every run.
//
// Run against the demo stack (./run.sh, then seeded), or any running stack:
//   SIGNALK_URL=http://localhost:3000 npx playwright test --config=screenshots.config.ts \
//     screenshots/webapp.spec.ts
// Outputs to screenshots/out/. capture-all.sh copies the published ones into ../../docs/images/.

const APP = '/plugins/sk-video/app/';
const CAMERAS = '/signalk/v2/api/resources/cameras';
const DEMO = [
  ['foredeck', 'Foredeck'],
  ['cockpit', 'Cockpit'],
  ['engine-room', 'Engine Room'],
  ['masthead', 'Masthead'],
] as const;

/** Reset to the four named demo cameras (all pointing at the MediaMTX test stream). */
async function resetCameras(request: APIRequestContext) {
  const list = await request
    .get(CAMERAS)
    .then((r) => (r.ok() ? r.json() : {}))
    .catch(() => ({}));
  for (const id of Object.keys((list as Record<string, unknown>) ?? {})) {
    await request.delete(`${CAMERAS}/${id}`).catch(() => undefined);
  }
  for (const [id, name] of DEMO) {
    await request
      .put(`${CAMERAS}/${id}`, {
        data: {
          name,
          enabled: true,
          source: { scheme: 'rtsp', host: 'mediamtx', port: 8554, path: '/cam' },
        },
      })
      .catch(() => undefined);
  }
}

test.beforeAll(async ({ request }) => {
  await resetCameras(request);
  // Warm go2rtc for every camera so the tiles reach a live frame instead of racing the grace timer.
  for (const [id] of DEMO) {
    await request.get(`/plugins/sk-video/cameras/${id}/frame.jpeg`).catch(() => undefined);
  }
});

test('webapp: empty Signal K plugin-config form', async ({ page }) => {
  await page.goto('/admin/#/serverConfiguration/plugins/sk-video', { waitUntil: 'networkidle' });
  await expect(page.getByText('SK Video', { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1500);
  await shot(page, 'admin-plugin-config');
});

test('webapp: Live Wall', async ({ page }) => {
  await page.goto(`${APP}#/live`);
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
  await expect(page.getByText('Foredeck')).toBeVisible();
  // Wait for the transport walk to land on a decodable rung so tiles show a real frame + the Live chip
  // (WebRTC's media port isn't published here, so it walks to HLS/MJPEG — which still flows a frame).
  await page
    .locator('.chip--live')
    .first()
    .waitFor({ timeout: 40_000 })
    .catch(() => undefined);
  await page.waitForTimeout(2500); // let the remaining tiles catch up
  await shot(page, 'app-live-wall');
});

test('webapp: Camera Focus', async ({ page }) => {
  await page.goto(`${APP}#/live/foredeck`);
  await expect(page.locator('.player')).toBeVisible();
  // Wait for the transport walk to land on a decodable rung (WebRTC's media port isn't published
  // here, so it falls to HLS/MJPEG) so the frame isn't black; then nudge the chrome back into view.
  await page
    .locator('.chip--live')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForTimeout(2000);
  await page.mouse.move(700, 360); // surface the auto-fading control dock
  await page.waitForTimeout(500);
  await shot(page, 'app-camera-focus');
});

test('webapp: Recordings DVR (scrubbed)', async ({ page, request }) => {
  await request.post(`/plugins/sk-video/cameras/foredeck/record`, { data: { active: true } });
  await page.waitForTimeout(6000); // let a couple of segments land
  await request.post(`/plugins/sk-video/cameras/foredeck/record`, { data: { active: false } });
  await page.goto(`${APP}#/review/recordings`);
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
  const track = page.getByRole('slider', { name: /Scrub foredeck/ }).first();
  await track.focus().catch(() => undefined);
  await track.press('ArrowRight').catch(() => undefined); // reveal the playhead + mark-incident panel
  await page.waitForTimeout(800);
  await shot(page, 'app-recordings');
});

test('webapp: Settings (Operational)', async ({ page }) => {
  await page.goto(`${APP}#/settings`);
  await expect(page.getByRole('heading', { name: 'Operational settings' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByText('Frigate (optional', { exact: false }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, 'app-settings');
});
