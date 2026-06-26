#!/usr/bin/env bash
# Seeds the harness with realistic demo data so screenshots feel like a real boat:
#   - several named cameras (all pointing at the MediaMTX test stream)
#   - a sample uploaded video
#   - a burst of live telemetry (position, speed, wind, depth, ...)
set -euo pipefail
cd "$(dirname "$0")"

BASE="${SIGNALK_URL:-http://localhost:3000}"

add_cam() { # id  name
  curl -fsS -X PUT "${BASE}/signalk/v2/api/resources/cameras/$1" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$2\",\"enabled\":true,\"source\":{\"scheme\":\"rtsp\",\"host\":\"mediamtx\",\"port\":8554,\"path\":\"/cam\"}}" \
    >/dev/null && echo "  camera: $2"
}

echo "Registering demo cameras..."
add_cam foredeck    "Foredeck"
add_cam cockpit     "Cockpit"
add_cam engine-room "Engine Room"
add_cam masthead    "Masthead"

echo "Uploading a sample video..."
TMP=$(mktemp /tmp/skv-XXXX.mp4)
printf '\x00\x00\x00\x20ftypisom' > "$TMP"
head -c 400000 /dev/zero >> "$TMP"
curl -fsS -X POST "${BASE}/plugins/sk-video/videos" \
  -H 'Content-Type: video/mp4' -H 'X-Filename: Chart%20Briefing.mp4' \
  --data-binary @"$TMP" >/dev/null && echo "  video: Chart Briefing.mp4"
rm -f "$TMP"

echo "Injecting live telemetry..."
node ./inject-telemetry.mjs "${BASE}" "${TELEMETRY_SECONDS:-8}" || echo "  (telemetry skipped)"

echo "Demo data ready."
