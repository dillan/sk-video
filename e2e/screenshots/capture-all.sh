#!/usr/bin/env bash
# Regenerate the documentation screenshots, end to end, against a throwaway demo stack.
#
#   ./capture-all.sh            capture everything (needs KIP for the widget shots)
#   ./capture-all.sh --admin    capture only the KIP-independent admin shots (fast, always works)
#   ./capture-all.sh --copy     also copy the results into ../../docs/images/
#
# What it does:
#   1. brings up the demo stack (Signal K + sk-video + a simulated camera) on SIGNALK_PORT (default 3010)
#   2. seeds STABLE, realistic demo data (named cameras, a sample clip, live telemetry) via seed-demo.sh
#   3. runs the Playwright capture specs into ./out
#   4. (with --copy) copies the doc images into ../../docs/images/
#
# The seed data is deterministic, so screenshots are reproducible across runs. The KIP widget shots
# additionally need KIP built and mounted (the compose file mounts ${KIP_PATH:-../../kip}); without it,
# use --admin for the shots that only need the core stack.
set -euo pipefail
cd "$(dirname "$0")/.."   # the e2e/ directory

PORT="${SIGNALK_PORT:-3010}"
BASE="http://localhost:${PORT}"
MODE="all"
COPY="no"
for arg in "$@"; do
  case "$arg" in
    --admin) MODE="admin" ;;
    --copy)  COPY="yes" ;;
  esac
done

echo "==> Bringing up the demo stack on :${PORT}"
SIGNALK_PORT="$PORT" docker compose up -d

echo "==> Waiting for Signal K + the plugin to be ready"
for _ in $(seq 1 90); do
  if curl -fsS "${BASE}/plugins/sk-video/status" 2>/dev/null | grep -q '"ready":true'; then break; fi
  sleep 2
done

echo "==> Seeding stable demo data"
SIGNALK_URL="$BASE" ./seed-demo.sh

echo "==> Capturing screenshots into screenshots/out/"
if [ "$MODE" = "admin" ]; then
  SIGNALK_URL="$BASE" npx playwright test --config=screenshots.config.ts screenshots/admin.spec.ts
else
  SIGNALK_URL="$BASE" npx playwright test --config=screenshots.config.ts
fi

if [ "$COPY" = "yes" ]; then
  echo "==> Copying doc images into ../docs/images/"
  DOCS="$(cd .. && pwd)/docs/images"
  mkdir -p "$DOCS"
  # The published doc set. Add a name here when a doc references a new screenshot.
  for name in admin-plugin-config widget-playing camera-setup ptz snapshot scan quality \
              source-tabs uploaded config-camera-manual config-url config-appearance \
              state-empty state-error; do
    if [ -f "screenshots/out/${name}.png" ]; then
      cp "screenshots/out/${name}.png" "${DOCS}/${name}.png" && echo "  ${name}.png"
    fi
  done
fi

echo "==> Done. Stop the stack with: ./run.sh --down"
