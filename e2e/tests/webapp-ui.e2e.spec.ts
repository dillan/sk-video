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

  test('is an installable PWA: serves a manifest and registers an app-shell service worker', async ({
    page,
    request,
  }) => {
    // The manifest is served same-origin with the right content type and a usable install identity.
    const manifestRes = await request.get(`${BASE}${APP}manifest.webmanifest`);
    expect(manifestRes.ok()).toBeTruthy();
    expect(manifestRes.headers()['content-type']).toContain('application/manifest+json');
    const manifest = JSON.parse(await manifestRes.text());
    expect(manifest.name).toBe('SK Video');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
    // A real PNG icon (for iOS apple-touch-icon + Android install) is served, not only the SVG.
    const png = await request.get(`${BASE}${APP}icons/icon-192.png`);
    expect(png.ok()).toBeTruthy();
    expect(png.headers()['content-type']).toContain('image/png');

    // The service worker registers and becomes active (localhost is a secure context).
    await page.goto(`${APP}#/live`);
    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.scope;
    });
    expect(scope).toContain('/plugins/sk-video/app/'); // scoped to the app, not the API
  });

  test('is listed in the Signal K webapps collection and boots at /sk-video/', async ({
    page,
    request,
  }) => {
    // The signalk-webapp keyword makes the server mount + list the app at /<name>/.
    const list = await request.get(`${BASE}/skServer/webapps`).then((r) => r.json());
    const entry = (list as Array<{ name: string; signalk?: { displayName?: string } }>).find(
      (w) => w.name === 'sk-video',
    );
    expect(entry).toBeTruthy();
    expect(entry?.signalk?.displayName).toBe('SK Video');

    // Boots at the webapp mount with assets resolving relatively (not only at /plugins/sk-video/app/).
    await page.goto('/sk-video/#/live');
    await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
    await expect(page.getByText('Test Camera')).toBeVisible(); // API reachable from this mount too
  });

  test('exposes a VAPID public key and accepts a push subscription', async ({ request }) => {
    // The browser needs the application-server public key before it can subscribe (ungated read).
    const keyRes = await request.get(plugin('/push/vapid-public-key'));
    expect(keyRes.ok()).toBeTruthy();
    const { key } = await keyRes.json();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(20);

    // A well-formed subscription is accepted (the open test server doesn't gate); a malformed one 400s.
    const ok = await request.post(plugin('/push/subscribe'), {
      data: {
        subscription: { endpoint: 'https://fcm.example/x', keys: { p256dh: 'k', auth: 'a' } },
      },
    });
    expect(ok.status()).toBe(201);
    const bad = await request.post(plugin('/push/subscribe'), {
      data: { subscription: { endpoint: 'http://insecure' } },
    });
    expect(bad.status()).toBe(400);
  });
});

test.describe('SK Video webapp — action-camera guided onboarding', () => {
  test('walks a GoPro through the push model and pre-fills the Insta360 preview', async ({
    page,
  }) => {
    await page.goto(`${APP}#/cameras`);
    await page.getByRole('button', { name: 'Add a camera' }).click();
    await page.getByRole('button', { name: 'Action camera (GoPro / Insta360)' }).click();

    // GoPro: push-only — the walkthrough teaches the RTMP relay and Continue waits for an address.
    await page.getByRole('button', { name: /GoPro/ }).click();
    await expect(page.getByText(/Run an RTMP server/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

    // Insta360: the known AP preview is pre-filled, projection rides along server-side.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: /Insta360/ }).click();
    await expect(page.getByPlaceholder('192.168.42.1')).toHaveValue('192.168.42.1');
    await expect(page.getByText(/reverse-engineered/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Test the stream' })).toBeVisible();
  });
});

test.describe('SK Video webapp — plain-stream (RTSP URL) onboarding', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${CAMERAS_URL}/pasted-cam`).catch(() => undefined);
  });

  test('pastes an rtsp:// URL, tests it against the REAL stream, and saves a working camera', async ({
    page,
    request,
  }) => {
    await page.goto(`${APP}#/cameras`);
    await page.getByRole('button', { name: 'Add a camera' }).click();
    await page.getByRole('button', { name: 'Paste a stream URL (rtsp:// or rtmp://…)' }).click();

    // The harness camera is a real RTSP source — the Test button runs a real server-side ffprobe.
    await page.getByPlaceholder('rtsp://192.168.1.50:554/stream1').fill('rtsp://mediamtx:8554/cam');
    // The probe shares the sensitive-route rate limiter (20/min) with the credential-presence reads
    // the other suites fire, so a full run can hit the honest "Rate-limited" chip — wait it out.
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.getByRole('button', { name: 'Test the stream' }).click();
      const outcome = await Promise.race([
        page
          .getByText(/reachable/i)
          .first()
          .waitFor({ timeout: 20_000 })
          .then(() => 'ok' as const),
        page
          .getByText(/Rate-limited/)
          .first()
          .waitFor({ timeout: 20_000 })
          .then(() => 'limited' as const),
      ]);
      if (outcome === 'ok') break;
      await page.waitForTimeout(20_000); // let the rolling window drain
    }
    await expect(page.getByText(/reachable/i).first()).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();
    // Identity defaulted from the host; set a deterministic id (for cleanup) and a visible name.
    const idField = page.locator('label', { hasText: 'Id' }).locator('input');
    await idField.fill('pasted-cam');
    const nameField = page.locator('label', { hasText: 'Name' }).locator('input');
    await nameField.fill('Pasted Cam');
    await page.getByRole('button', { name: 'Save camera' }).click();

    // The saved camera is a real resource: it appears on the manage list by its name…
    await expect(page.getByText('Pasted Cam').first()).toBeVisible({ timeout: 15_000 });
    // …and the resource carries the exact source, with no credentials anywhere near it.
    const saved = await request.get(`${CAMERAS_URL}/pasted-cam`).then((r) => r.json());
    expect(saved.source).toMatchObject({ scheme: 'rtsp', host: 'mediamtx', port: 8554 });
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

  test('Operational settings save Frigate config and round-trip through the restart', async ({
    page,
    request,
  }) => {
    await page.goto(`${APP}#/settings`);
    const host = page.getByRole('textbox', { name: 'MQTT host' });
    await expect(host).toBeVisible({ timeout: 15_000 });
    await host.fill('10.0.0.42');
    await page.getByRole('textbox', { name: 'Alert labels' }).fill('person');
    await page.getByRole('button', { name: 'Save & apply' }).click();
    await expect(page.getByText(/restarting/)).toBeVisible();

    // The plugin restarts; poll the API until the new config is persisted + served back.
    await pollJson(
      request,
      plugin('/operational-config'),
      (c: { frigate?: { mqttHost?: string } }) => c.frigate?.mqttHost === '10.0.0.42',
      30_000,
    );
    const cfg = await request.get(plugin('/operational-config')).then((r) => r.json());
    expect(cfg.frigate.mqttHost).toBe('10.0.0.42');
    expect(cfg.frigate.labels).toBe('person');

    // Restore an unconfigured Frigate: the saved broker persists in plugin-config-data, and the
    // Frigate-unconfigured contract tests (safety.e2e) depend on a clean stack. PUT replaces the
    // WHOLE config (the settings form always sends everything), so send the full doc back.
    // GET decorates frigate with the read-only mqttPasswordSet flag; PUT validation rejects it.
    const { mqttPasswordSet, ...frigateWritable } = cfg.frigate ?? {};
    void mqttPasswordSet; // read-only decoration — excluded from the write, not used
    const restore = await request.put(plugin('/operational-config'), {
      data: { ...cfg, frigate: { ...frigateWritable, mqttHost: '' } },
    });
    expect(restore.ok()).toBeTruthy();
    await pollJson(
      request,
      plugin('/operational-config'),
      (c: { frigate?: { mqttHost?: string } }) => (c.frigate?.mqttHost ?? '') === '',
      30_000,
    );
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

  test('offers the sub variant in the stream menu only when the camera has one', async ({
    page,
  }) => {
    await page.goto(`${APP}#/live/subcam`);
    await page.getByRole('button', { name: 'Stream variant' }).click();
    await expect(page.getByRole('menuitemradio', { name: /^Main/ })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /^Sub/ })).toBeVisible();

    await page.goto(`${APP}#/live/${CAMERA}`);
    await page.reload(); // hash-only nav keeps the menu's open state; a fresh load resets it
    await expect(page.locator('.player')).toBeVisible();
    await page.getByRole('button', { name: 'Stream variant' }).click();
    await expect(page.getByRole('menuitemradio', { name: /^Main/ })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /^Sub/ })).toHaveCount(0);
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

test.describe('SK Video webapp — Library / Videos', () => {
  test('uploads, plays, and deletes a video from the thumbnail grid', async ({ page }) => {
    const NAME = 'webapp-ui-clip.mp4';
    await page.goto(`${APP}#/library/videos`);
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible();

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

    const tile = page.locator('.vidtile', { hasText: NAME });
    await expect(tile).toHaveCount(1); // exactly one tile after a single upload
    await expect(tile.getByText(NAME)).toBeVisible();

    // Clicking the thumbnail opens the full-screen player.
    await tile.getByRole('button', { name: `Play ${NAME}` }).click();
    await expect(page.locator('.vidmodal video')).toBeVisible();
    await page.getByRole('button', { name: 'Close player' }).click();
    await expect(page.locator('.vidmodal')).toHaveCount(0);

    // The red trashcan asks first, then deletes.
    await tile.getByRole('button', { name: `Delete ${NAME}` }).click();
    await tile.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(tile).toHaveCount(0);
  });
});

test.describe('SK Video webapp — Library (Recordings + Incidents)', () => {
  test('the Library tabs default to Recordings and switch', async ({ page }) => {
    await page.goto(`${APP}#/library`);
    await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
    await page.getByRole('button', { name: 'Incidents' }).click();
    await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
    await page.getByRole('button', { name: 'Events' }).click();
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
    await page.getByRole('button', { name: 'Videos' }).click();
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible();
  });

  test('Recordings shows a scrubbable DVR track and marks an incident from a scrubbed moment', async ({
    page,
    request,
  }) => {
    await request.post(plugin(`/cameras/${CAMERA}/record`), { data: { active: true } });
    await new Promise((r) => setTimeout(r, 5000)); // let a couple of segments land on disk
    await request.post(plugin(`/cameras/${CAMERA}/record`), { data: { active: false } });

    await page.goto(`${APP}#/library/recordings`);
    await expect(page.getByText(CAMERA, { exact: true })).toBeVisible({ timeout: 15_000 });
    // The DVR tabs by camera; if other cameras have leftover footage, select our camera's tab.
    const tab = page.getByRole('button', { name: CAMERA, exact: true });
    if (await tab.count()) await tab.first().click();
    const track = page.getByRole('slider', { name: new RegExp(`Scrub ${CAMERA}`) });
    await expect(track).toBeVisible();

    // Scrub with the keyboard (deterministic) until the playhead lands on a covered moment, then mark.
    await track.focus();
    await track.press('ArrowRight');
    const mark = page.getByRole('button', { name: /Mark incident here/ });
    await expect(mark).toBeVisible();
    await mark.click();
    await expect(page.getByText(/Incident marked/)).toBeVisible({ timeout: 15_000 });
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
    await page.goto(`${APP}#/library/incidents`);
    const row = page.locator('.incident__row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByRole('heading', { name: 'Incident' })).toBeVisible();
    await expect(page.getByText(/best-effort/)).toBeVisible();
  });

  test('Incident export.zip downloads a real archive', async ({ request }) => {
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
    const zip = await request.get(plugin(`/incidents/${id}/export.zip`));
    expect(zip.ok()).toBeTruthy();
    expect(zip.headers()['content-type']).toBe('application/zip');
    expect(zip.headers()['content-disposition']).toContain('attachment');
    const body = await zip.body();
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK'); // zip magic bytes
    // the archive carries the honesty README
    expect(body.toString('latin1')).toContain('README.txt');
  });

  test('Events records a triggered incident in the durable feed', async ({ page, request }) => {
    // Minting an incident raises an `incident` notification, which the bridge taps into the event log.
    await request.post(plugin('/incidents'), {
      data: { cameras: [CAMERA], preMs: 0, postMs: 1000 },
    });
    await page.goto(`${APP}#/library/events`);
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
    // The incident event shows as a humanised "Incident" row in the feed.
    await expect(page.locator('.event', { hasText: 'Incident' }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Snapshots shows a captured still', async ({ page, request }) => {
    await request.post(plugin(`/cameras/${CAMERA}/snapshot`), { data: {} });
    await page.goto(`${APP}#/library/snapshots`);
    await expect(page.getByRole('heading', { name: 'Snapshots' })).toBeVisible();
    await expect(page.locator('.snap').first()).toBeVisible({ timeout: 15_000 });
  });
});
