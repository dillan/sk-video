# SK Video

A [Signal K](https://signalk.org/) server plugin that makes IP cameras usable in the browser — for
[KIP](https://github.com/mxtommy/Kip)'s Video widget and any other Signal K app.

Browsers can't play `rtsp://` / `rtmp://` directly, can't speak ONVIF, and can't discover devices on
the network. SK Video fills those gaps server‑side:

- **Gateway** — manages [go2rtc](https://github.com/AlexxIT/go2rtc) to repackage RTSP/RTMP/ONVIF
  cameras into browser‑playable **WebRTC / HLS / MSE / MJPEG**, transcoding HEVC→H.264 when needed.
- **Cameras as resources** — camera definitions are exposed through the standard Signal K
  [Resources API](https://demo.signalk.org/documentation/develop/rest-api/resources_api.html) as a
  custom `cameras` type, so they're shareable and discoverable.
- **ONVIF PTZ** — pan/tilt/zoom control proxied to the camera.
- **Discovery** — find ONVIF cameras on the LAN (WS‑Discovery + mDNS).
- **Uploads** — store and serve recorded video files with HTTP range requests.

> Camera credentials are stored server‑side only and never exposed in the public camera resource.

## Status

Early development. **P1 — plugin skeleton + the `cameras` resource provider** is in place; the
gateway, ONVIF, discovery and uploads follow.

## Install

Until it's published to npm, install from this repo into your Signal K server (`~/.signalk`):

```sh
cd ~/.signalk
npm install /path/to/sk-video   # or: npm install dillan/sk-video
```

Then enable **SK Video** in the Signal K server admin UI.

## Develop

```sh
npm install
npm run build      # tsc → dist/
npm test           # vitest
npm run lint
```

## License

MIT
