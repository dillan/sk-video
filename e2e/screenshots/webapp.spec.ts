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

// One demo camera per view, pointed at its matching MediaMTX still-image path (see e2e/stills/), with a
// realistic mount/role/bearing so the Live Wall reads as one vessel. Foredeck is the "hero" with a full
// capability set (so Camera Focus shows the whole floating-cluster control set + the Cameras list shows
// chips); a couple of others carry lighter caps and the rest stay plain (honest "no chips" rows).
const DEMO: Array<{
  id: string;
  name: string;
  mount: string;
  bearing?: number;
  role: string;
  caps?: Record<string, unknown>;
}> = [
  {
    id: 'foredeck',
    name: 'Foredeck',
    mount: 'mast',
    bearing: 0,
    role: 'navigation',
    caps: {
      ptz: true,
      absolutePtz: true,
      audio: true,
      audioBackchannel: true,
      imaging: ['irCut', 'brightness'],
    },
  },
  { id: 'stern', name: 'Stern', mount: 'mast', bearing: 180, role: 'cockpit' },
  {
    id: 'bow',
    name: 'Bow',
    mount: 'bow',
    bearing: 0,
    role: 'docking',
    caps: { ptz: true, absolutePtz: true },
  },
  { id: 'port', name: 'Port', mount: 'port', bearing: 270, role: 'general' },
  { id: 'starboard', name: 'Starboard', mount: 'starboard', bearing: 90, role: 'general' },
  { id: 'engine-room', name: 'Engine Room', mount: 'engine', role: 'engine' },
];

/** Reset to the demo cameras, each pointed at its own MediaMTX still-image path. */
async function resetCameras(request: APIRequestContext) {
  const list = await request
    .get(CAMERAS)
    .then((r) => (r.ok() ? r.json() : {}))
    .catch(() => ({}));
  for (const id of Object.keys((list as Record<string, unknown>) ?? {})) {
    await request.delete(`${CAMERAS}/${id}`).catch(() => undefined);
  }
  for (const cam of DEMO) {
    await request
      .put(`${CAMERAS}/${cam.id}`, {
        data: {
          name: cam.name,
          enabled: true,
          source: { scheme: 'rtsp', host: 'mediamtx', port: 8554, path: `/${cam.id}` },
          role: cam.role,
          placement: {
            mount: cam.mount,
            ...(cam.bearing !== undefined ? { bearingRelativeDeg: cam.bearing } : {}),
          },
          ...(cam.caps ? { capabilities: cam.caps } : {}),
          ...(cam.id === 'foredeck'
            ? { device: { manufacturer: 'REOLINK', model: 'RLC-823S2', firmware: 'v3.1.0.0' } }
            : {}),
        },
      })
      .catch(() => undefined);
  }
}

test.beforeAll(async ({ request }) => {
  await resetCameras(request);
  // Warm go2rtc for every camera so the tiles reach a live frame instead of racing the grace timer.
  for (const cam of DEMO) {
    await request.get(`/plugins/sk-video/cameras/${cam.id}/frame.jpeg`).catch(() => undefined);
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
  // Wait for (nearly) every tile to reach a live frame so the happy-path shot has no "Connecting…"
  // stragglers. capture-all.sh advertises a reachable WebRTC candidate, so the walk lands on WebRTC;
  // without it the tiles fall to HLS/MJPEG — either way a frame flows. We poll the live-chip count up
  // to DEMO.length and settle for the last tile, with a hard cap so a genuinely dead source can't hang.
  await page
    .locator('.chip--live')
    .first()
    .waitFor({ timeout: 40_000 })
    .catch(() => undefined);
  // Best-effort: wait until all tiles are live, but never fail the capture if one source stays down.
  await page
    .waitForFunction((n) => document.querySelectorAll('.chip--live').length >= n, DEMO.length, {
      timeout: 40_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(1500); // let the last frame paint
  await shot(page, 'app-live-wall');
});

test('webapp: Camera Focus', async ({ page }) => {
  await page.goto(`${APP}#/live/foredeck`);
  await expect(page.locator('.player')).toBeVisible();
  // Wait for a live frame so it isn't black. With the harness's WebRTC candidate the walk lands on
  // WebRTC (low-latency, enabled PTZ pad); otherwise it falls to HLS/MJPEG (still-refresh, paused pad).
  await page
    .locator('.chip--live')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForTimeout(2000);
  await page.mouse.move(700, 360); // surface the auto-fading control clusters
  await page.waitForTimeout(500);
  await shot(page, 'app-camera-focus');
  // A focused crop of the aim cluster: the glass PTZ joystick pad, zoom pill, and STOP.
  await shot(page, 'app-ptz', '.ccenter');
});

test('webapp: Cameras management', async ({ page }) => {
  await page.goto(`${APP}#/cameras`);
  await expect(page.getByRole('heading', { name: 'Cameras' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Foredeck')).toBeVisible();
  // Let the capability chips + credential presence resolve so the row is complete.
  await page.waitForTimeout(1500);
  await shot(page, 'app-cameras');
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
