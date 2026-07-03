import { test, expect } from '@playwright/test';
import { plugin, CAMERA, ensureCamera } from './helpers';

/**
 * The MOB console journey (plan §8): arm from the console UI, verify the honest armed state (banner,
 * target line, aimed count, heartbeat), confirm a fresh client seeds the armed state from GET /mob
 * before any delta arrives, then disarm with the hold gesture. The harness camera has no absolute-PTZ
 * calibration, so the console must say 0 aimed — never fabricate an aim.
 */

const APP = '/plugins/sk-video/app/';

test.beforeAll(async ({ request }) => {
  await ensureCamera(request, CAMERA, { name: 'Test Camera' });
});

test.afterEach(async ({ request }) => {
  // Never leave an armed MOB behind for the other suites.
  await request.post(plugin('/mob'), { data: { active: false } }).catch(() => undefined);
});

test('arm from the console: honesty banner, honest aim count, shell strip, hold-to-disarm', async ({
  page,
}) => {
  await page.goto(`${APP}#/safety`);
  const arm = page.getByRole('button', { name: 'Arm man overboard' });
  await arm.waitFor({ timeout: 20_000 });
  // The standing honesty banner is present BEFORE arming (it frames the whole console).
  await expect(page.getByText(/not visual person-tracking/)).toBeVisible();

  await arm.click();
  await expect(page.getByRole('heading', { name: 'Man overboard' })).toBeVisible({
    timeout: 15_000,
  });
  // No GPS fix in the harness → the console must say it cannot aim, never fabricate a target.
  await expect(page.getByText(/No target — no GPS fix or beacon/)).toBeVisible();
  await expect(page.getByText(/of 0 cameras aimed|0.*of 0/).first()).toBeVisible();
  // The persistent shell strip escalates too.
  await expect(page.getByText('MOB ACTIVE')).toBeVisible();

  // Hold-to-disarm: a quick tap must NOT disarm; only the full hold does.
  const hold = page.getByRole('button', { name: 'Hold to disarm' });
  await hold.click(); // pointer down+up quickly
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { name: 'Man overboard' })).toBeVisible();

  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1200); // past the hold threshold
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Arm man overboard' })).toBeVisible({
    timeout: 10_000,
  });
});

test('a fresh client seeds the armed state from GET /mob (reconnect rule)', async ({
  page,
  request,
}) => {
  const armed = await request.post(plugin('/mob'), { data: {} });
  expect(armed.ok()).toBeTruthy();

  // A brand-new page load (no prior delta context) must show the armed console immediately.
  await page.goto(`${APP}#/safety`);
  await expect(page.getByRole('heading', { name: 'Man overboard' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('MOB ACTIVE')).toBeVisible();
});
