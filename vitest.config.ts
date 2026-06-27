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
        'src/diagnostics/probe-runner.ts',
      ],
      // A regression ratchet, not an aspiration: set a few points below current coverage
      // (~96% lines / 94% branches / 100% functions) so a meaningful drop fails CI without
      // breaking on a small, well-tested addition. Raise further as coverage climbs.
      thresholds: {
        statements: 92,
        branches: 88,
        functions: 95,
        lines: 92,
      },
    },
  },
});
