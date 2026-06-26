import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const KIP = '/@mxtommy/kip/index.html';
const OUT = join(__dirname, 'out');
mkdirSync(OUT, { recursive: true });
const DIALOG = 'mat-dialog-container';

const SNAPSHOT = { embedTelemetry: true, embedLocation: true, defaultDestination: 'download' };

function dashboardsJson(displayName: string, video: Record<string, unknown>) {
  return JSON.stringify([
    {
      id: 'demo',
      name: 'Underway',
      icon: 'dashboard-dashboard',
      collapseSplitShell: true,
      configuration: [
        {
          w: 24,
          h: 24,
          x: 0,
          y: 0,
          id: 'vid',
          selector: 'widget-host2',
          input: {
            widgetProperties: { type: 'widget-video', uuid: 'vid', config: { displayName, video } },
          },
        },
      ],
    },
  ]);
}

/** Load Demo writes a full valid config (appConfig/theme/connection) so KIP won't first-run-reset. */
async function bootstrapKip(page: Page) {
  await page.goto(KIP);
  try {
    await page.getByRole('button', { name: 'Load Demo' }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
  } catch {
    console.log('  (Load Demo not shown — already configured)');
  }
}

/** Force a dashboard on every subsequent navigation (beats KIP's unload-save clobber). */
async function setDashboard(page: Page, displayName: string, video: Record<string, unknown>) {
  await page.addInitScript(
    (dash) => localStorage.setItem('dashboardsConfig', dash),
    dashboardsJson(displayName, video),
  );
  await page.goto(KIP);
  await page.evaluate(() => (location.hash = '#/dashboard/0'));
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string, target?: string) {
  const path = join(OUT, `${name}.png`);
  try {
    const loc = target ? page.locator(target).first() : null;
    if (loc) await loc.waitFor({ timeout: 5000 });
    await (loc ? loc.screenshot({ path }) : page.screenshot({ path }));
    console.log(`  captured ${name}.png`);
  } catch (e) {
    console.log(`  FAILED ${name}.png: ${(e as Error).message.split('\n')[0]}`);
  }
}

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

  // Resolve the real uploaded MP4 so the hero shot shows actual moving video.
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
    await shot(page, 'camera-setup', DIALOG);
    await shot(page, 'source-tabs', DIALOG);

    try {
      await page.locator('mat-button-toggle:has-text("Camera")').click();
      await page.getByRole('button', { name: /Scan network/i }).click();
      await page.waitForTimeout(1500);
      await shot(page, 'scan', DIALOG);
    } catch (e) {
      console.log('  scan: ' + (e as Error).message.split('\n')[0]);
    }

    try {
      await page.locator('mat-button-toggle:has-text("Uploaded")').click();
      await page.waitForTimeout(900);
      await shot(page, 'uploaded', DIALOG);
    } catch (e) {
      console.log('  uploaded: ' + (e as Error).message.split('\n')[0]);
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
