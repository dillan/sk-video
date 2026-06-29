/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The plugin serves this build same-origin under /plugins/sk-video/app/, so every asset URL must
// resolve under that path (not the site root). Output goes to the repo's public/ dir, which the
// plugin's package.json ships and the app-routes handler serves.
export default defineConfig({
  base: '/plugins/sk-video/app/',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.spec.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        // Media-IO binding (WHEP/HLS/MJPEG) — its WebRTC/native-HLS branches can't run under jsdom and
        // are verified against the e2e harness (a real go2rtc + stream). The testable rung-selection /
        // fallback logic lives in lib/transport.ts, which IS unit-tested.
        'src/components/VideoPlayer.tsx',
      ],
      // A modest island threshold; raise it as real screens land.
      thresholds: { statements: 70, branches: 70, functions: 70, lines: 70 },
    },
  },
});
