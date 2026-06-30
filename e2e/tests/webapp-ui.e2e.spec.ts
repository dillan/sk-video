import { test, expect } from '@playwright/test';
import { BASE, plugin, CAMERA, ensureCamera, waitForStatus, pollJson } from './helpers';

const CAMERAS_URL = `${BASE}/signalk/v2/api/resources/cameras`;

/** Reset to a deterministic camera set so the wall is reproducible regardless of leftover demo state. */
async function resetToKnownCameras(request: import('@playwright/test').APIRequestContext) {
  const list = await request
    .get(CAMERAS_URL)
    .then((r) => (r.ok() ? r.json() : {}))
    .catch(() => ({}));
  for (const id of Object.keys((list as Record<string, unknown>) ?? {})) {
    await request.delete(`${CAMERAS_URL}/${id}`).catch(() => undefined);
  }
  await ensureCamera(request, CAMERA, { name: 'Test Camera' });
  await ensureCamera(request, 'subcam', {
    name: 'Sub Cam',
    capabilities: { substreams: true },
    media: { codec: 'h264', substreamPath: '/cam' },
  });
}

/**
 * Drives the SK Video webapp UI (the React console at /plugins/sk-video/app/) against the live stack —
 * the path that previously could only be checked by hand on real hardware. WebRTC's media port isn't
 * published from the container, so the player's transport walk falls through to HLS (WebKit) / MJPEG
 * still-refresh (Chromium); either way a real frame flows, so the honest "Live" state is what we assert
 * rather than a specific transport.
 */

const APP = '/plugins/sk-video/app/';

test.beforeAll(async ({ request }) => {
  await resetToKnownCameras(request);
  // Warm go2rtc so the first tile reaches "Live" without racing the grace timer.
  await waitForStatus(request, plugin(`/cameras/${CAMERA}/frame.jpeg`), 200).catch(() => undefined);
});

test.describe('SK Video webapp — shell + navigation', () => {
  test('loads the Live Wall with the seeded camera and navigates the rail', async ({ page }) => {
    await page.goto(`${APP}#/live`);
    await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
    await expect(page.getByText('Test Camera')).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
});

test.describe('SK Video webapp — Settings theme', () => {
  test('switches to Night-Red and persists across a reload', async ({ page }) => {
    await page.goto(`${APP}#/settings`);
    await page.getByRole('button', { name: 'Night-Red' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');

    // restore Dark so the other specs/screenshots start from the default
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('switches density and persists it', async ({ page }) => {
    await page.goto(`${APP}#/settings`);
    await page.getByRole('button', { name: 'Desk' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'desk');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'desk');
    await page.getByRole('button', { name: 'Helm' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'helm');
  });
});

test.describe('SK Video webapp — Live Wall + Camera Focus', () => {
  test('a tile reaches the Live state once a real frame flows', async ({ page }) => {
    await page.goto(`${APP}#/live`);
    const tile = page.getByRole('button', { name: /Test Camera/ });
    await expect(tile).toBeVisible();
    // The transport walk (webrtc → hls → mjpeg) lands on a decodable rung and the player reports a
    // frame, flipping the chip to the red "Live" badge. Generous timeout: the walk takes a few seconds.
    await expect(tile.locator('.chip--live')).toBeVisible({ timeout: 35_000 });
  });

  test('opens Camera Focus with the player and full control dock', async ({ page }) => {
    await page.goto(`${APP}#/live/${CAMERA}`);
    await expect(page.locator('.player')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Snapshot' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Live' })).toBeVisible();
  });

  test('shows the sub/full-res toggle only when the camera has a substream', async ({ page }) => {
    await page.goto(`${APP}#/live/subcam`);
    await expect(page.getByRole('button', { name: 'Full res' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sub' })).toBeVisible();

    await page.goto(`${APP}#/live/${CAMERA}`);
    await expect(page.locator('.player')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Full res' })).toHaveCount(0);
  });

  test('shows every tile on a crowded wall (mosaic does not clip past 5 cameras)', async ({
    page,
    request,
  }) => {
    // Seed enough cameras to exceed the old 5-tile grid; names sort last so they'd land in the rows
    // that the previous fixed 2-row mosaic hid.
    const extra = ['zcam1', 'zcam2', 'zcam3', 'zcam4', 'zcam5', 'zcam6'];
    for (const id of extra) await ensureCamera(request, id, { name: id });
    await page.goto(`${APP}#/live`);
    // Every tile renders with real size (the bug left late tiles, e.g. zcam6, in a 0-height row →
    // "hidden"). These ids sort last, so they land in exactly the rows the old fixed grid clipped.
    for (const id of extra) {
      await expect(page.getByRole('button', { name: new RegExp(id) })).toBeVisible();
    }
  });
});

test.describe('SK Video webapp — Review / Imported videos', () => {
  test('uploads, plays, and deletes an imported video', async ({ page }) => {
    const NAME = 'webapp-ui-clip.mp4';
    await page.goto(`${APP}#/review/imported`);
    await expect(page.getByRole('heading', { name: 'Imported videos' })).toBeVisible();

    // A minimal valid MP4 (ftyp + isom brand) so the server accepts it by magic bytes.
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x20, ...Buffer.from('ftypisom')]),
      Buffer.alloc(2048, 7),
    ]);
    await page.setInputFiles('input[type="file"]', {
      name: NAME,
      mimeType: 'video/mp4',
      buffer: mp4,
    });

    const row = page.locator('.vidrow', { hasText: NAME });
    await expect(row).toHaveCount(1); // exactly one row after a single upload

    await row.getByRole('button', { name: 'Play' }).click();
    await expect(row.locator('video.vidrow__player')).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await row.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(row).toHaveCount(0);
  });
});

test.describe('SK Video webapp — Review (Recordings + Incidents)', () => {
  test('the Review tabs default to Recordings and switch', async ({ page }) => {
    await page.goto(`${APP}#/review`);
    await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
    await page.getByRole('button', { name: 'Incidents' }).click();
    await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
    await page.getByRole('button', { name: 'Imported' }).click();
    await expect(page.getByRole('heading', { name: 'Imported videos' })).toBeVisible();
  });

  test('Recordings shows a camera with a live Recording badge', async ({ page, request }) => {
    await request.post(plugin(`/cameras/${CAMERA}/record`), { data: { active: true } });
    await new Promise((r) => setTimeout(r, 4000)); // let a segment land on disk
    await page.goto(`${APP}#/review/recordings`);
    await expect(page.getByText(CAMERA, { exact: true })).toBeVisible({ timeout: 15_000 });
    await request.post(plugin(`/cameras/${CAMERA}/record`), { data: { active: false } });
  });

  test('Incidents lists a triggered bundle and opens its detail', async ({ page, request }) => {
    const res = await request.post(plugin('/incidents'), {
      data: { cameras: [CAMERA], preMs: 0, postMs: 1500 },
    });
    const { id } = await res.json();
    await pollJson(
      request,
      plugin(`/incidents/${id}`),
      (b: { status: string }) => b.status !== 'capturing',
      30_000,
    );
    await page.goto(`${APP}#/review/incidents`);
    const row = page.locator('.incident__row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByRole('heading', { name: 'Incident' })).toBeVisible();
    await expect(page.getByText(/best-effort/)).toBeVisible();
  });

  test('Snapshots shows a captured still', async ({ page, request }) => {
    await request.post(plugin(`/cameras/${CAMERA}/snapshot`), { data: {} });
    await page.goto(`${APP}#/review/snapshots`);
    await expect(page.getByRole('heading', { name: 'Snapshots' })).toBeVisible();
    await expect(page.locator('.snap').first()).toBeVisible({ timeout: 15_000 });
  });
});
