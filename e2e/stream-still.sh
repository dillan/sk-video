#!/bin/sh
# Publish a stable RTSP stream for one demo-camera VIEW. Runs inside the MediaMTX container (which
# bundles ffmpeg), invoked from mediamtx.yml runOnInit. It loops a still image (stills/<name>.jpg) if
# one is present, otherwise a plain test pattern — so the screenshot harness works with or without the
# generated stills. A single looping still is the most stable possible "video" for reproducible shots.
#
#   arg 1 = view name = the RTSP path to publish to (e.g. "foredeck")
set -eu
NAME="$1"
STILL="/stills/${NAME}.jpg"
TARGET="rtsp://localhost:8554/${NAME}"

if [ -f "$STILL" ]; then
  # Loop the still as a steady 15 fps H.264 stream. -tune stillimage + a 2 s keyframe interval keep it
  # cheap and give go2rtc/WHEP a keyframe promptly.
  exec ffmpeg -hide_banner -loglevel warning -re -loop 1 -i "$STILL" \
    -c:v libx264 -preset veryfast -tune stillimage -profile:v high -pix_fmt yuv420p -r 15 -g 30 \
    -f rtsp -rtsp_transport tcp "$TARGET"
fi

# Fallback: the same test pattern the harness has always used, so a shot still renders something.
exec ffmpeg -hide_banner -loglevel warning -re -f lavfi -i "testsrc2=size=1280x720:rate=15" \
  -c:v libx264 -preset veryfast -tune zerolatency -profile:v baseline -pix_fmt yuv420p -g 30 \
  -f rtsp -rtsp_transport tcp "$TARGET"
