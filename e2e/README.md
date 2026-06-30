# SK Video — end-to-end harness

A reproducible Docker stack that exercises the **live** path of the SK Video plugin and the KIP video widget against a simulated camera, plus a Playwright suite (Chromium + WebKit).

```
 ffmpeg test pattern ─▶ mediamtx (RTSP) ─▶ sk-video plugin ─▶ go2rtc ─▶ browser (HLS/WebRTC/snapshot)
                                    └─▶ onvif (opt-in) ─▶ plugin PTZ proxy
                          Signal K server also serves the KIP webapp at /@mxtommy/kip
```

## What it verifies

| Path | How |
| --- | --- |
| RTSP camera → browser **HLS** via the gateway | real go2rtc pulls the mediamtx stream; the e2e fetches `…/stream.m3u8` |
| **Snapshot** frame | `…/frame.jpeg` returns a real JPEG |
| Camera **resource CRUD** + SSRF/scheme validation | seed script PUTs a `cameras` resource |
| **Video upload** + magic-byte validation + **HTTP Range** | e2e uploads a tiny MP4 and re-fetches it with a `Range` header (206) |
| Plugin **status** / wiring | `…/status` (also asserts the `hardware.tier` from the plugin config) |
| **KIP webapp** loads (same-origin with the plugin) | Playwright opens `/@mxtommy/kip` |
| **ONVIF / PTZ** (opt-in) | the virtual ONVIF device answers the plugin's PTZ proxy over unicast HTTP |
| **DVR recording** (C10) + **health** (F6) + substream variant (C6.2) | `recording.e2e.spec.ts` — start/stop, list, Range-serve a segment; `…/health`; `whep?variant=sub` 404 |
| **Incident bundles** (C9) | `incidents.e2e.spec.ts` — trigger → finalize → manifest, Range assets, pin (DELETE 409), unpin + delete |
| **Layout hints** (C7) + **360 projection** (A2) + **onboarding hints** (A3) + **slew** (C8) + **imaging** (C5) | `awareness.e2e.spec.ts` |
| **Man overboard** (C2) + **Frigate** (C4, unconfigured) | `safety.e2e.spec.ts` — MOB activate/deactivate + emergency notification; Frigate clip endpoints 503 |
| **SK Video webapp UI** (Live Wall / Camera Focus / Settings) | `webapp-ui.e2e.spec.ts` — Playwright drives the React console (Chromium + WebKit): a tile reaches the **Live** state once a real frame flows, Camera Focus opens with the control dock + the sub/full-res toggle, and the **Dark / Night-Red** theme switch persists. This covers the UI that previously could only be checked by hand on real hardware. |

The new feature specs live alongside the original `video.e2e.spec.ts` in `tests/`, sharing `tests/helpers.ts`. They run against the same stack — no extra services — except imaging's success path, which needs the `--onvif` profile and an ONVIF-backed camera (the RTSP-only `testcam` exercises the 502 error path instead). DVR recording is gated on the hardware tier, so the harness pins `hardwareTier: "x86"` in `signalk-config/plugin-config-data/sk-video.json`.

## Prerequisites

- Docker + Docker Compose.
- This repo checked out, with the KIP repo next to it (`../kip`) or `KIP_PATH` set.

## Run

```bash
cd e2e
./run.sh                 # builds the plugin + KIP, starts the stack, seeds the camera
npm install && npx playwright install
npm test                 # Chromium + WebKit
./run.sh --down          # tear down
```

The first camera triggers a one-time download of the pinned go2rtc binary into the plugin data dir, so the Signal K container needs internet egress on first run. To run fully offline, drop a matching `go2rtc` binary into `signalk-config/plugins/sk-video/` before starting (see the plugin's binary manager for the expected name).

## ONVIF / PTZ (opt-in)

```bash
./run.sh --onvif         # also builds + starts the virtual ONVIF device
```

The virtual device (built from [daniela-hase/onvif-server](https://github.com/daniela-hase/onvif-server)) presents the mediamtx stream as an ONVIF Profile-S camera with PTZ. **ONVIF and PTZ are unicast HTTP, so they work over the compose network**: add a camera with `scheme: onvif`, `host: onvif`, `port: 8081` and the plugin's PTZ proxy will reach it.

**WS-Discovery / mDNS need multicast**, which Docker Desktop on macOS/Windows does not pass between the host and containers — so the plugin's "Scan" won't find the device there. On a Linux host you can run the onvif service with `network_mode: host` to make discovery work; otherwise discovery is covered by the plugin's unit tests and you add the camera directly (as the seed script does). Physical PTZ motion is simulated (the device acknowledges moves), so PTZ exercises the request path, not real movement.

## Notes

- The stack runs Signal K with no security config (anonymous read/write) for a turnkey local test — do not expose it. The plugin's own security envelope (scheme allow-list, SSRF guard, write-only credentials, Range clamping) is still in force and is what these tests exercise.
- Ports: Signal K `3000`, RTSP `8554`, mediamtx HLS `8888` / WebRTC `8889`, ONVIF `8081`.
