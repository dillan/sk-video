import { type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// KIP screenshot/automation harness — the one fix for "the Tutorial dashboard
// keeps coming back".
//
// THE PROBLEM
//   KIP is a PWA that owns its own localStorage config. When it loads with an
//   incomplete / first-run config it performs a *first-run reset*: it rewrites
//   localStorage — including `dashboardsConfig` — back to defaults, and the
//   default is the "Changing Layouts" Tutorial widget. On top of that, KIP
//   saves the live config back to localStorage on `beforeunload`, so a value
//   you set before a navigation gets clobbered by the page you just left. The
//   service worker adds a third hazard: it can reload/reset the page under you.
//   The net effect: you inject a video dashboard, KIP loads, and you get the
//   Tutorial widget instead. Every time.
//
// THE FIX (three defenses, all required)
//   1. bootstrapKip(): click "Load Demo" FIRST. That writes a *complete, valid*
//      config (appConfig/theme/connection), so KIP no longer first-run-resets
//      and stops wiping dashboardsConfig.
//   2. setDashboard(): re-inject `dashboardsConfig` via addInitScript so it is
//      reapplied on EVERY navigation — this beats the beforeunload save clobber.
//   3. serviceWorkers:'block' (set in screenshots.config.ts) so the worker can't
//      reload/reset the page mid-capture.
//
// Import these helpers instead of re-deriving them; keeping a single copy is the
// whole point — duplicated copies are how this bug came back before.
// ---------------------------------------------------------------------------

export const KIP = '/@mxtommy/kip/index.html';
export const DIALOG = 'mat-dialog-container';
export const OUT = join(__dirname, 'out');
mkdirSync(OUT, { recursive: true });

/** A reasonable default snapshot config for video widgets used in captures. */
export const SNAPSHOT = {
  embedTelemetry: true,
  embedLocation: true,
  defaultDestination: 'download',
};

/** Build a one-video-widget dashboard. `video` may be null for an unconfigured widget. */
export function dashboardsJson(displayName: string, video: Record<string, unknown> | null): string {
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

/**
 * Defense #1: write a valid base config so KIP won't first-run-reset (which is
 * what wipes an injected dashboard back to the Tutorial widget). Call this ONCE
 * per page, before setDashboard.
 */
export async function bootstrapKip(page: Page): Promise<void> {
  await page.goto(KIP);
  try {
    await page.getByRole('button', { name: 'Load Demo' }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
  } catch {
    console.log('  (Load Demo not shown — already configured)');
  }
}

/**
 * Defense #2: force a dashboard on every navigation. addInitScript re-applies
 * the value before KIP's own scripts run, so it survives the beforeunload save
 * clobber. Safe to call repeatedly to swap the widget config between shots.
 */
export async function setDashboard(
  page: Page,
  displayName: string,
  video: Record<string, unknown> | null,
): Promise<void> {
  await page.addInitScript(
    (dash) => localStorage.setItem('dashboardsConfig', dash),
    dashboardsJson(displayName, video),
  );
  await page.goto(KIP);
  await page.evaluate(() => (location.hash = '#/dashboard/0'));
  await page.waitForTimeout(500);
}

/**
 * Enter edit mode and open the video widget's config dialog. Retries once
 * because the first double-click can land before edit mode is fully active.
 * Returns true when the dialog is open.
 */
export async function openVideoConfig(page: Page): Promise<boolean> {
  await page.keyboard.press('Control+Shift+E'); // toggle edit mode
  await page.waitForTimeout(800);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) await page.keyboard.press('Escape');
      await page
        .locator('widget-host2')
        .first()
        .dblclick({ position: { x: 36, y: 36 }, timeout: 8000 });
      await page.locator(DIALOG).first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(700);
      return true;
    } catch (e) {
      if (attempt)
        console.log('  config dialog did not open: ' + (e as Error).message.split('\n')[0]);
    }
  }
  return false;
}

/** Screenshot `target` (or the full page) into OUT/<name>.png, logging success/failure. */
export async function shot(page: Page, name: string, target?: string): Promise<void> {
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
