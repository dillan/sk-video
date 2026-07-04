import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CAMERA, ensureCamera } from './helpers';

/**
 * Automated accessibility gate (axe-core) over the console's primary screens, per the design's
 * WCAG-AA floor. Serious/critical violations fail the run; minor/moderate ones are reported in the
 * assertion message but tolerated (the AA floor is the gate, perfection is follow-up work). Screens
 * are scanned in the default Dark theme — the theme-contract unit tests hold the other themes to
 * their own invariants (contrast is re-checked there via red-dominance / token rules).
 */

const APP = '/plugins/sk-video/app/';

const SCREENS: Array<{ name: string; hash: string; ready: string }> = [
  { name: 'Live Wall', hash: '#/live', ready: 'h1:has-text("Live")' },
  { name: 'Cameras', hash: '#/cameras', ready: 'h1:has-text("Cameras")' },
  { name: 'Safety (disarmed)', hash: '#/safety', ready: 'h1:has-text("Safety")' },
  {
    name: 'Library — Recordings',
    hash: '#/library/recordings',
    ready: 'h1:has-text("Recordings")',
  },
  { name: 'Library — Events', hash: '#/library/events', ready: 'h1:has-text("Events")' },
  { name: 'Settings', hash: '#/settings', ready: 'h1:has-text("Settings")' },
];

test.beforeAll(async ({ request }) => {
  await ensureCamera(request, CAMERA, { name: 'Test Camera' });
});

for (const screen of SCREENS) {
  test(`axe: ${screen.name} has no serious/critical violations`, async ({ page }) => {
    await page.goto(`${APP}${screen.hash}`);
    await page.locator(screen.ready).first().waitFor({ timeout: 20_000 });
    // Let async data (chips, lists) settle so axe scans the real screen, not a loading skeleton.
    await page.waitForTimeout(1500);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const description = blocking
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`)
      .join('\n');
    expect(blocking, description).toEqual([]);
  });
}
