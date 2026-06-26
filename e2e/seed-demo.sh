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

# A real, playable clip the screenshot script uses for the "video playing" hero (it picks the
# largest uploaded video). Set HERO_CLIP=/path/to.mp4 to use your own footage. The published docs
# hero used a short recording of the Annapolis Yacht Club Spa Creek public webcam
# (https://www.annapolisyc.com/webcams). Without a clip provided, a harbour-style test pattern is
# generated so the hero still shows real moving video.
HERO="${HERO_CLIP:-}"
GEN=""
if [ -z "$HERO" ]; then
  GEN=$(mktemp /tmp/skv-hero-XXXX.mp4); HERO="$GEN"
  FF="ffmpeg"; command -v ffmpeg >/dev/null 2>&1 || FF=""
  if [ -n "$FF" ]; then
    ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=15 -t 8 -an \
      -c:v libx264 -preset veryfast -profile:v baseline -pix_fmt yuv420p -movflags +faststart "$HERO" \
      >/dev/null 2>&1
  else
    docker exec skv-mediamtx ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=15 -t 8 -an \
      -c:v libx264 -preset veryfast -profile:v baseline -pix_fmt yuv420p -movflags +faststart /tmp/hero.mp4 \
      >/dev/null 2>&1 && docker cp skv-mediamtx:/tmp/hero.mp4 "$HERO" >/dev/null 2>&1
  fi
fi
if [ -s "$HERO" ]; then
  curl -fsS -X POST "${BASE}/plugins/sk-video/videos" \
    -H 'Content-Type: video/mp4' -H 'X-Filename: Harbour.mp4' \
    --data-binary @"$HERO" >/dev/null && echo "  video: Harbour.mp4 (hero clip)"
else
  echo "  (no ffmpeg — skipping the hero clip; provide HERO_CLIP to add real footage)"
fi
[ -n "$GEN" ] && rm -f "$GEN"

echo "Injecting live telemetry..."
node ./inject-telemetry.mjs "${BASE}" "${TELEMETRY_SECONDS:-8}" || echo "  (telemetry skipped)"

echo "Demo data ready."
