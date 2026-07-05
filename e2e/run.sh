#!/usr/bin/env bash
# Builds the plugin and the KIP webapp, then brings an e2e stack up.
#
#   ./run.sh              build + start the core stack (mediamtx + signalk + plugin + KIP)
#   ./run.sh --onvif      also start the virtual ONVIF device (for PTZ)
#   ./run.sh --secured    build + start ONLY the security-enabled server (port 3001) for the auth e2e
#   ./run.sh --down       stop and remove every profile's containers + volumes
set -euo pipefail
cd "$(dirname "$0")"

PLUGIN_DIR="$(cd .. && pwd)"
KIP_DIR="${KIP_PATH:-$(cd ../../kip 2>/dev/null && pwd || true)}"
SECURED_PORT="${SIGNALK_SECURED_PORT:-3001}"
CORE_PORT="${SIGNALK_PORT:-3000}"

MODE="core"
case "${1:-}" in
  --down)
    docker compose --profile onvif --profile secured down -v
    exit 0
    ;;
  --onvif) MODE="onvif" ;;
  --secured) MODE="secured" ;;
  "") MODE="core" ;;
  *)
    echo "usage: run.sh [--onvif | --secured | --down]" >&2
    exit 2
    ;;
esac

build_plugin() {
  echo "==> Building the sk-video plugin + webapp"
  # Build BOTH the plugin (tsc → dist) and the webapp (Vite → public/) — the stack mounts the repo,
  # so the served UI/API are only current if dist/ and public/ are rebuilt first.
  (cd "$PLUGIN_DIR" && npm run build && npm run build:webapp)
}

wait_for() { # url label
  echo "==> Waiting for $2 to answer"
  for _ in $(seq 1 60); do
    if curl -fsS "$1" >/dev/null 2>&1; then
      echo "    up."
      return 0
    fi
    sleep 2
  done
  echo "!! $2 did not answer at $1 within 120s" >&2
  return 1
}

# --- Secured lane: just the security-enabled server, for the auth e2e (no camera stream / KIP) ---
if [[ "$MODE" == "secured" ]]; then
  build_plugin
  echo "==> Starting the SECURED server (security enabled, port ${SECURED_PORT})"
  docker compose --profile secured up -d --build signalk-secured
  wait_for "http://localhost:${SECURED_PORT}/signalk" "Signal K (secured)"
  cat <<EOF

Secured server is up.
  Signal K (secured):  http://localhost:${SECURED_PORT}
  Fixture logins:      admin / e2e-password (admin) · viewer / e2e-password (read-only)

Run the auth e2e:
  SECURED_URL=http://localhost:${SECURED_PORT} npm run test:auth
Stop everything:       ./run.sh --down
EOF
  exit 0
fi

# --- Core lane: the full stack (mediamtx + signalk + plugin + KIP) ---
build_plugin

if [[ -n "$KIP_DIR" && -d "$KIP_DIR" ]]; then
  echo "==> Building KIP ($KIP_DIR)"
  (cd "$KIP_DIR" && npm run build:all)
  export KIP_PATH="$KIP_DIR"
else
  echo "!! KIP not found next to this repo. Set KIP_PATH=/path/to/kip and re-run to serve the UI."
  echo "   The server-side e2e (API contract) still works without it."
fi

# macOS ships bash 3.2, where "${EMPTY[@]}" trips `set -u` — use ${arr[@]+…} to expand safely.
PROFILE=()
[[ "$MODE" == "onvif" ]] && PROFILE=(--profile onvif)

echo "==> Starting the stack"
docker compose ${PROFILE[@]+"${PROFILE[@]}"} up -d --build

wait_for "http://localhost:${CORE_PORT}/signalk" "Signal K"

echo "==> Seeding the test camera"
./seed-camera.sh || echo "   (seed failed — server may still be starting; re-run ./seed-camera.sh)"

cat <<EOF

Stack is up.
  Signal K:        http://localhost:${CORE_PORT}
  KIP webapp:      http://localhost:${CORE_PORT}/@mxtommy/kip
  Plugin status:   http://localhost:${CORE_PORT}/plugins/sk-video/status
  Camera HLS:      http://localhost:${CORE_PORT}/plugins/sk-video/cameras/testcam/stream.m3u8

Run the e2e tests:   npm install && npm test   (browsers install automatically)
Run the auth e2e:    ./run.sh --secured   then   SECURED_URL=http://localhost:${SECURED_PORT} npm run test:auth
Stop the stack:      ./run.sh --down
EOF
