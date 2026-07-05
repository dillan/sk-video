/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// RELATIVE base so one build is mount-agnostic: assets resolve against the document, which lets the
// exact same bundle work both where the plugin serves it (/plugins/sk-video/app/) and where
// signalk-server mounts it as a listed webapp (/sk-video/, from the signalk-webapp keyword). Hash
// routing means the document path is always the mount root, so relative asset URLs always resolve.
// Output goes to the repo's public/ dir, which the plugin's package.json ships and serves.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    // A real (non-opaque) origin so jsdom enables window.localStorage — with the default
    // about:blank origin it is undefined and every persistence path silently no-ops.
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.spec.{ts,tsx}',
        'src/test-setup.ts',
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
