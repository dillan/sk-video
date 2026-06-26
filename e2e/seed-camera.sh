#!/usr/bin/env bash
# Registers a camera resource pointing at the mediamtx test stream, so the gateway starts pulling it.
# Discovery is bypassed here (Docker Desktop doesn't pass the WS-Discovery multicast); on a Linux
# host you can instead use the plugin's "Scan" with the onvif profile running.
set -euo pipefail

BASE="${SIGNALK_URL:-http://localhost:3000}"
ID="${CAMERA_ID:-testcam}"

echo "Registering camera '${ID}' -> rtsp://mediamtx:8554/cam"
curl -fsS -X PUT "${BASE}/signalk/v2/api/resources/cameras/${ID}" \
  -H 'Content-Type: application/json' \
  -d '{
        "name": "Test Camera",
        "enabled": true,
        "source": { "scheme": "rtsp", "host": "mediamtx", "port": 8554, "path": "/cam" }
      }'
echo
echo "Done. The gateway will warm up go2rtc; HLS appears at:"
echo "  ${BASE}/plugins/sk-video/cameras/${ID}/stream.m3u8"
