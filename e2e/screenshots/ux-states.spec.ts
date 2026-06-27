import { test } from '@playwright/test';
import {
  bootstrapKip,
  DIALOG,
  openVideoConfig as openConfig,
  setDashboard,
  shot,
  SNAPSHOT,
} from './kip-harness';

// Captures the extra widget/config states the docs shots miss, as input to the UX review.
// The KIP-bootstrap helpers and the Tutorial-clobber fix they encode live in ./kip-harness.ts.

test('capture extra UX states', async ({ page }) => {
  await page.route('**/plugins/sk-video/cameras/discover', (route) =>
    route.fulfill({
      json: {
        cameras: [
          {
            name: 'Foredeck Cam',
            host: '192.168.1.41',
            port: 554,
            onvifUrl: 'http://192.168.1.41/onvif/device_service',
          },
          { name: 'Cockpit Dome', host: '192.168.1.42', port: 554 },
          { name: 'Engine Bay', host: '192.168.1.43', port: 8554 },
        ],
      },
    }),
  );
  // Give a camera PTZ presets so the preset menu renders.
  await page.route('**/plugins/sk-video/cameras/*/ptz/presets', (route) =>
    route.fulfill({
      json: {
        presets: [
          { token: 'p1', name: 'Dock approach' },
          { token: 'p2', name: 'Anchor watch' },
        ],
      },
    }),
  );

  await bootstrapKip(page);

  // --- Empty / unconfigured widget ---
  await setDashboard(page, 'Foredeck', {
    sourceKind: 'url',
    url: null,
    transport: 'auto',
    snapshot: SNAPSHOT,
  });
  await page.waitForTimeout(1200);
  await shot(page, 'state-empty', 'widget-video');

  // --- URL source config (the transport dropdown + jargon hint) ---
  await setDashboard(page, 'Foredeck', {
    sourceKind: 'url',
    url: null,
    transport: 'auto',
    snapshot: SNAPSHOT,
  });
  if (await openConfig(page)) {
    try {
      await page.locator('mat-button-toggle:has-text("URL")').click();
      await page.waitForTimeout(400);
      await shot(page, 'config-url', DIALOG);
    } catch (e) {
      console.log('  config-url: ' + (e as Error).message.split('\n')[0]);
    }
    // --- Camera source with the manual-add form expanded (shows Test connection) ---
    try {
      await page.locator('mat-button-toggle:has-text("Camera")').click();
      await page.waitForTimeout(500);
      await page
        .getByRole('button', { name: /^Add a camera$/ })
        .click({ timeout: 3000 })
        .catch(() => {});
      await page.waitForTimeout(400);
      await page
        .getByText('Test connection', { exact: false })
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await page.waitForTimeout(300);
      await shot(page, 'config-camera-manual', DIALOG);
    } catch (e) {
      console.log('  config-camera-manual: ' + (e as Error).message.split('\n')[0]);
    }
    // --- Appearance section ---
    try {
      await page.getByText('Appearance', { exact: false }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, 'config-appearance', DIALOG);
    } catch (e) {
      console.log('  config-appearance: ' + (e as Error).message.split('\n')[0]);
    }
    await page.keyboard.press('Escape').catch(() => {});
  }

  // --- Snapshot destination menu open (on a playing file source) ---
  const assetId = await page.evaluate(async () => {
    try {
      const r = await fetch('/plugins/sk-video/videos');
      const { videos } = await r.json();
      return (
        (videos as { id: string; size: number }[]).sort((a, b) => b.size - a.size)[0]?.id ?? null
      );
    } catch {
      return null;
    }
  });
  if (assetId) {
    await setDashboard(page, 'Foredeck', {
      sourceKind: 'file',
      fileAssetId: assetId,
      transport: 'auto',
      muted: true,
      autoplay: true,
      loop: true,
      objectFit: 'cover',
      label: 'Foredeck',
      snapshot: SNAPSHOT,
    });
    try {
      await page.locator('widget-video video').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(2500);
      await shot(page, 'state-titled'); // title bar above the video + centred 44px controls
      await page.locator('widget-video').first().hover();
      await page.locator('button[aria-label="Snapshot destination"]').click({ timeout: 5000 });
      await page.waitForTimeout(400);
      await shot(page, 'state-snapshot-menu');
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) {
      console.log('  state-snapshot-menu: ' + (e as Error).message.split('\n')[0]);
    }
  }

  // --- Camera source: PTZ presets menu open ---
  await setDashboard(page, 'Foredeck', {
    sourceKind: 'camera',
    cameraId: 'foredeck',
    transport: 'hls',
    preset: 'balanced',
    muted: true,
    autoplay: true,
    objectFit: 'cover',
    snapshot: SNAPSHOT,
  });
  try {
    await page.locator('widget-video').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.locator('widget-video').first().hover();
    await page.locator('button[aria-label="Camera presets"]').click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await shot(page, 'state-presets-menu');
    await page.keyboard.press('Escape').catch(() => {});
  } catch (e) {
    console.log('  state-presets-menu: ' + (e as Error).message.split('\n')[0]);
  }

  // --- Error / reconnecting toast: make the gateway stream fail ---
  await page.route('**/plugins/sk-video/cameras/*/stream.m3u8', (route) =>
    route.fulfill({ status: 502, body: 'down' }),
  );
  await page.route('**/plugins/sk-video/cameras/*/hls/**', (route) =>
    route.fulfill({ status: 502, body: 'down' }),
  );
  await setDashboard(page, 'Foredeck', {
    sourceKind: 'camera',
    cameraId: 'foredeck',
    transport: 'hls',
    preset: 'balanced',
    muted: true,
    autoplay: true,
    objectFit: 'cover',
    snapshot: SNAPSHOT,
  });
  try {
    await page.locator('widget-video').first().waitFor({ timeout: 10000 });
    // Wait for reconnect attempts to surface the toast.
    await page.locator('.video-widget__toast').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await shot(page, 'state-error', 'widget-video');
  } catch (e) {
    console.log('  state-error: ' + (e as Error).message.split('\n')[0]);
    await shot(page, 'state-error', 'widget-video'); // capture whatever is there
  }
});
