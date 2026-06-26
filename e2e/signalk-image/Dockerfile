# Signal K server plus ffmpeg, which go2rtc needs for JPEG snapshots (frame.jpeg) and any transcode.
# ffmpeg is a real production dependency of the gateway; the harness installs it so the snapshot path
# is exercised too.
FROM signalk/signalk-server:latest
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
USER node
