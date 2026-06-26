#!/usr/bin/env bash
# Builds the plugin and the KIP webapp, then brings the core e2e stack up.
#
#   ./run.sh              build + start the core stack (mediamtx + signalk + plugin + KIP)
#   ./run.sh --onvif      also start the virtual ONVIF device (for PTZ)
#   ./run.sh --down       stop and remove the stack
set -euo pipefail
cd "$(dirname "$0")"

PLUGIN_DIR="$(cd .. && pwd)"
KIP_DIR="${KIP_PATH:-$(cd ../../kip 2>/dev/null && pwd || true)}"

if [[ "${1:-}" == "--down" ]]; then
  docker compose --profile onvif down -v
  exit 0
fi

echo "==> Building the sk-video plugin"
( cd "$PLUGIN_DIR" && npm run build )

if [[ -n "$KIP_DIR" && -d "$KIP_DIR" ]]; then
  echo "==> Building KIP ($KIP_DIR)"
  ( cd "$KIP_DIR" && npm run build:all )
  export KIP_PATH="$KIP_DIR"
else
  echo "!! KIP not found next to this repo. Set KIP_PATH=/path/to/kip and re-run to serve the UI."
  echo "   The server-side e2e (API contract) still works without it."
fi

PROFILE=()
[[ "${1:-}" == "--onvif" ]] && PROFILE=(--profile onvif)

echo "==> Starting the stack"
docker compose "${PROFILE[@]}" up -d --build

echo "==> Waiting for Signal K to answer"
for i in $(seq 1 60); do
  if curl -fsS http://localhost:3000/signalk >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "==> Seeding the test camera"
./seed-camera.sh || echo "   (seed failed — server may still be starting; re-run ./seed-camera.sh)"

cat <<EOF

Stack is up.
  Signal K:        http://localhost:3000
  KIP webapp:      http://localhost:3000/@mxtommy/kip
  Plugin status:   http://localhost:3000/plugins/sk-video/status
  Camera HLS:      http://localhost:3000/plugins/sk-video/cameras/testcam/stream.m3u8

Run the e2e tests:   npm install && npx playwright install && npm test
Stop the stack:      ./run.sh --down
EOF
