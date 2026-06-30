import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the running docker stack (start it with ./run.sh first).
 * WebKit is included because the widget's design pivots on Safari quirks (MJPEG, MSE, HLS).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One shared backend stack (signalk + go2rtc + mediamtx) — run specs serially so stateful flows
  // (MOB, recording, and the A1 spec's transient plugin-config change) never race across files.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SIGNALK_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
