import { test } from '@playwright/test';
import { bootstrapKip, DIALOG, setDashboard, shot, SNAPSHOT } from './kip-harness';

// Helpers (bootstrapKip / setDashboard / shot) and the Tutorial-clobber fix they
// encode live in ./kip-harness.ts — see that file for why all three defenses matter.

test('capture documentation screenshots', async ({ page }) => {
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
          { name: 'Masthead', host: '192.168.1.44', port: 554 },
        ],
      },
    }),
  );

  await bootstrapKip(page);

  // Resolve the uploaded MP4 for the hero shot. Prefer the Annapolis harbour clip (real footage that
  // reads as a boat camera); fall back to the largest uploaded video if it isn't present.
  const assetId = await page.evaluate(async () => {
    try {
      const r = await fetch('/plugins/sk-video/videos');
      const { videos } = await r.json();
      const list = videos as { id: string; size: number; name?: string }[];
      const annapolis = list.find((v) => /annapolis/i.test(v.name ?? ''));
      return (annapolis ?? [...list].sort((a, b) => b.size - a.size)[0])?.id ?? null;
    } catch {
      return null;
    }
  });
  console.log('  using video asset: ' + assetId);

  // --- 1) Hero: a real video playing on the dashboard (file source) ---
  if (assetId) {
    await setDashboard(page, 'Foredeck', {
      sourceKind: 'file',
      fileAssetId: assetId,
      transport: 'auto',
      muted: true,
      autoplay: true,
      loop: true,
      objectFit: 'cover',
      snapshot: SNAPSHOT,
    });
    try {
      await page.locator('widget-video video').first().waitFor({ timeout: 15000 });
    } catch {
      /* */
    }
    await page.waitForTimeout(4000);
    await shot(page, 'widget-playing');
  }

  // --- 2) Camera source: PTZ controls + the settings dialog ---
  await setDashboard(page, 'Foredeck', {
    sourceKind: 'camera',
    cameraId: 'foredeck',
    transport: 'hls',
    preset: 'balanced',
    muted: true,
    autoplay: true,
    loop: false,
    objectFit: 'cover',
    snapshot: SNAPSHOT,
  });
  try {
    await page.locator('widget-video').first().waitFor({ timeout: 15000 });
  } catch {
    console.log('  WARN: camera widget did not load');
  }
  await page.waitForTimeout(2000);
  try {
    await page.locator('widget-video').first().hover();
    await page.waitForTimeout(400);
  } catch {
    /* */
  }
  await shot(page, 'ptz', 'widget-video');

  await page.keyboard.press('Control+Shift+E'); // edit mode
  await page.waitForTimeout(800);
  let dialogOpen = false;
  for (let attempt = 0; attempt < 2 && !dialogOpen; attempt++) {
    try {
      if (attempt) await page.keyboard.press('Escape');
      await page
        .locator('widget-host2')
        .first()
        .dblclick({ position: { x: 36, y: 36 }, timeout: 8000 });
      await page.locator(DIALOG).first().waitFor({ timeout: 5000 });
      dialogOpen = true;
    } catch (e) {
      if (attempt)
        console.log('  config dialog did not open: ' + (e as Error).message.split('\n')[0]);
    }
  }

  if (dialogOpen) {
    await page.waitForTimeout(800);
    // Note: source-tabs / camera-setup / uploaded (the dialog shots that show the Quality & Latency
    // presets) are owned by recapture-docs.spec.ts, which frames them deterministically. Capturing
    // them here too would just fight over the same filenames with worse framing.

    try {
      await page.locator('mat-button-toggle:has-text("Camera")').click();
      await page.getByRole('button', { name: /Scan network/i }).click();
      await page.waitForTimeout(1500);
      await shot(page, 'scan', DIALOG);
    } catch (e) {
      console.log('  scan: ' + (e as Error).message.split('\n')[0]);
    }

    try {
      await page.locator('mat-button-toggle:has-text("URL")').click();
      await page.waitForTimeout(400);
      await page.getByText('Quality', { exact: false }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, 'quality', DIALOG);
      await page.getByText('Snapshot', { exact: false }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, 'snapshot', DIALOG);
    } catch (e) {
      console.log('  quality/snapshot: ' + (e as Error).message.split('\n')[0]);
    }

    await page.keyboard.press('Escape').catch(() => {});
  }

  // --- 3) The plugin in the Signal K admin ---
  try {
    await page.goto('/admin/#/serverConfiguration/plugins/sk-video');
    await page.waitForTimeout(3000);
    await shot(page, 'plugin-config');
  } catch (e) {
    console.log('  plugin-config: ' + (e as Error).message.split('\n')[0]);
  }
});
