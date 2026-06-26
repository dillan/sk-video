# A virtual ONVIF Profile-S device that wraps the mediamtx RTSP stream. Built from the
# daniela-hase/onvif-server project (a widely used virtual ONVIF server). It answers ONVIF SOAP
# (GetProfiles, stream URI, PTZ) over unicast HTTP and broadcasts WS-Discovery.
#
# Pinned to a commit for reproducibility; bump deliberately.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /onvif
ARG ONVIF_REF=master
RUN git clone https://github.com/daniela-hase/onvif-server.git . \
    && git checkout "${ONVIF_REF}" \
    && npm install --omit=dev

# config.yaml is bind-mounted at runtime.
EXPOSE 8081
CMD ["node", "main.js", "./config.yaml"]
