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
