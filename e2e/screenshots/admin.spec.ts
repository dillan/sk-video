import { test, expect } from '@playwright/test';
import { shot } from './kip-harness';

// KIP-INDEPENDENT documentation captures. Unlike capture.spec.ts / recapture-docs.spec.ts (which drive
// the KIP video widget and therefore need KIP built and mounted), these only need the core stack
// running: Signal K + the sk-video plugin + a seeded camera or two. That makes them the reliable shots
// you can always regenerate.
//
// Run against the demo stack (start it with ./run.sh and seed it with ./seed-demo.sh):
//   SIGNALK_URL=http://localhost:3000 npx playwright test --config=screenshots.config.ts \
//     screenshots/admin.spec.ts
// Outputs to screenshots/out/. Copy the ones you want into ../../docs/images/.

test('admin: the SK Video plugin config page', async ({ page }) => {
  // The Signal K admin is an Angular SPA; the plugin config lives at a hash route.
  await page.goto('/admin/#/serverConfiguration/plugins/sk-video', { waitUntil: 'networkidle' });
  // Wait for the plugin's config card to render (its name is the most stable anchor).
  await expect(page.getByText('SK Video', { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1500); // let the schema form finish laying out
  await shot(page, 'admin-plugin-config');
});

test('admin: the plugin status banner', async ({ page }) => {
  await page.goto('/admin/#/serverConfiguration/plugins/sk-video', { waitUntil: 'networkidle' });
  await expect(page.getByText('SK Video', { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
  // The plugin's setPluginStatus line ("Ready — N cameras · <tier>") shows near the top of the card.
  await page.waitForTimeout(1500);
  await shot(page, 'admin-status');
});
