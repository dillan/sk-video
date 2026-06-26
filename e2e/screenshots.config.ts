import { defineConfig, devices } from '@playwright/test';

// Captures documentation screenshots against the running demo stack (start it with ./run.sh and seed
// with ./seed-demo.sh). Separate from the CI e2e tests. Run: npm run screenshots.
export default defineConfig({
  testDir: './screenshots',
  timeout: 300_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.SIGNALK_URL || 'http://localhost:3000',
    actionTimeout: 12_000, // fail individual steps fast so one stuck step doesn't eat the budget
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    // KIP is a PWA; its service worker reloads/resets the page and fights our injected config.
    serviceWorkers: 'block',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'docs', use: {} }],
});
