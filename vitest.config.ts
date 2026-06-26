import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        // Thin entrypoint: wires the pieces together; covered by the Signal K integration e2e.
        'src/index.ts',
        // External IO wrappers (spawn go2rtc, open an ONVIF connection); covered by the e2e harness,
        // not unit-testable without the real binary/device.
        'src/gateway/go2rtc-process.ts',
        'src/onvif/onvif-connect.ts',
      ],
      // A regression ratchet, not an aspiration: set just below current coverage so it can't slip.
      // Branches/functions sit high because the extracted logic is unit-tested; lines/statements are
      // lower because Express route wiring is exercised by the e2e harness. Raise these as we add tests.
      thresholds: {
        statements: 70,
        branches: 80,
        functions: 85,
        lines: 70,
      },
    },
  },
});
