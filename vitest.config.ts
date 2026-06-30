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
        // External IO wrappers (open an ONVIF connection); covered by the e2e harness,
        // not unit-testable without the real device.
        'src/onvif/onvif-connect.ts',
        'src/diagnostics/probe-runner.ts',
        // Thin MQTT.js adapter for Frigate; the client orchestration is unit-tested against its interface.
        'src/analytics/frigate-mqtt.ts',
      ],
      // A regression ratchet, not an aspiration: set a few points below current coverage
      // (~96% lines / 94% branches / 100% functions) so a meaningful drop fails CI without
      // breaking on a small, well-tested addition. Raise further as coverage climbs.
      // Re-baselined for vitest 4 / coverage-v8 4, which counts functions more granularly than v2
      // did (no source changed; the measurement did). Still a regression ratchet a few points below
      // the current actuals (~95 stmts / 88 branches / 94 funcs / 95 lines).
      thresholds: {
        statements: 92,
        branches: 87,
        functions: 90,
        lines: 92,
      },
    },
  },
});
