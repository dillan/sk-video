import { test } from '@playwright/test';
import { bootstrapKip, DIALOG, openVideoConfig, setDashboard, shot, SNAPSHOT } from './kip-harness';

// Canonical capture for the config-dialog doc shots that show the Quality & Latency presets:
// source-tabs (URL source), uploaded (Uploaded source), and camera-setup (Camera source with the
// "Add a camera" form). Kept separate from capture.spec.ts so these three have a single writer with
// deterministic framing — capture.spec.ts intentionally does NOT also emit them.
//
// Run: SIGNALK_URL=http://localhost:3000 npx playwright test \
//   --config=screenshots.config.ts screenshots/recapture-docs.spec.ts
// then copy out/{source-tabs,uploaded,camera-setup}.png into the KIP/sk-video docs image folders.
test('recapture source-tabs / uploaded / camera-setup', async ({ page }) => {
  await page.route('**/plugins/sk-video/cameras/discover', (route) =>
    route.fulfill({ json: { cameras: [] } }),
  );
  await bootstrapKip(page);

  await setDashboard(page, 'Foredeck', {
    sourceKind: 'url',
    url: 'https://example.com/deck-camera.m3u8',
    transport: 'auto',
    snapshot: SNAPSHOT,
  });
  if (!(await openVideoConfig(page))) throw new Error('config dialog did not open');

  // source-tabs: URL source, full dialog (Source selector through Quality & Appearance).
  await page.locator('mat-button-toggle:has-text("URL")').click();
  await page.waitForTimeout(400);
  await shot(page, 'source-tabs', DIALOG);

  // uploaded: Uploaded source, full dialog.
  await page.locator('mat-button-toggle:has-text("Uploaded")').click();
  await page.waitForTimeout(600);
  await shot(page, 'uploaded', DIALOG);

  // camera-setup: Camera source with the "Add a camera" form expanded + filled, scrolled so the form
  // and the Quality & Latency presets are both in view.
  await page.locator('mat-button-toggle:has-text("Camera")').click();
  await page.waitForTimeout(500);
  await page
    .getByRole('button', { name: /^Add a camera$/ })
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('input[formControlName="name"]').fill('Foredeck');
  await page.locator('input[formControlName="host"]').fill('192.168.1.50');
  await page.locator('input[formControlName="port"]').fill('554');
  await page.locator('input[formControlName="path"]').fill('/stream1');
  // Leave the Title empty — nothing has been added yet, so it shouldn't read as pre-filled.
  await page
    .locator('input[formControlName="label"]')
    .fill('')
    .catch(() => {});
  // Anchor the camera-type/address/port row at the top so the whole "Add a camera" form and the
  // Quality presets are both in view (matches the committed framing).
  await page
    .locator('.video-setup__manual-row')
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await shot(page, 'camera-setup', DIALOG);

  await page.keyboard.press('Escape').catch(() => {});
});
