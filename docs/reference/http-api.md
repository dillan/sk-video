# HTTP API reference

Every endpoint the plugin exposes, grouped by feature. All paths are under
**`/plugins/sk-video`** (so `/status` is `http://server:3000/plugins/sk-video/status`).

Two ground rules hold everywhere:

- **Same-origin only.** The browser talks to these endpoints; the plugin talks to go2rtc and the
  cameras. A browser never reaches go2rtc or a camera directly, and a client-supplied `src=` is never
  honored.
- **`503` until started.** Anything that needs the plugin's services returns `503` until the plugin has
  finished starting.

Camera definitions are managed through the standard Signal K Resources API at
`/signalk/v2/api/resources/cameras` — not through these routes.

---

## Status & credentials

| Method   | Path                       | Purpose                                                           | Notes                               |
| -------- | -------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| `GET`    | `/status`                  | Plugin health: ready flag, camera count, detected hardware.       | —                                   |
| `GET`    | `/cameras/:id/credentials` | Whether a login is stored (presence flags only — **no secrets**). | rate-limited (20/min)               |
| `POST`   | `/cameras/:id/credentials` | Store a write-only camera login (never echoed).                   | rate-limited (20/min) → `204`       |
| `DELETE` | `/cameras/:id/credentials` | Delete a stored login.                                            | rate-limited (20/min) → `204`/`404` |

## Streaming gateway

| Method | Path                         | Purpose                                                                                            | Codes               |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| `POST` | `/cameras/:id/whep`          | WebRTC (WHEP) signaling — POST an SDP offer, get an answer. `?variant=sub` selects the sub-stream. | `200`, `404`, `502` |
| `GET`  | `/cameras/:id/stream.m3u8`   | HLS master playlist.                                                                               | `200`, `404`, `502` |
| `GET`  | `/cameras/:id/hls/:resource` | HLS media playlist / segments / init segment.                                                      | `200`, `404`, `502` |
| `GET`  | `/cameras/:id/frame.jpeg`    | A single JPEG still from the stream (served `no-store`).                                           | `200`, `404`, `502` |
| `GET`  | `/cameras/:id/health`        | Diagnostic: negotiated codecs, online/producer/consumer counts (source URLs **redacted**).         | `200`, `502`        |
| `GET`  | `/cameras/:id/transport`     | The recommended transport-fallback walk (`webrtc → hls → mjpeg`, codec-aware).                     | `200`, `502`        |
| `POST` | `/cameras/:id/talk`          | Two-way audio backchannel (WebRTC SDP with a talk track). Gated on the camera reporting a speaker. | `200`, `404`, `502` |

## PTZ & imaging (ONVIF)

| Method | Path                          | Purpose                                                              | Codes                             |
| ------ | ----------------------------- | -------------------------------------------------------------------- | --------------------------------- |
| `POST` | `/cameras/:id/ptz`            | Relative pan/tilt/zoom move (velocity-clamped).                      | `204`, `404`, `502`, `503`        |
| `POST` | `/cameras/:id/ptz/stop`       | Stop the current move.                                               | `204`, `404`, `502`, `503`        |
| `GET`  | `/cameras/:id/ptz/presets`    | List the camera's saved presets.                                     | `200`, `404`, `502`, `503`        |
| `POST` | `/cameras/:id/ptz/preset`     | Go to a preset by token.                                             | `204`, `404`, `502`, `503`        |
| `GET`  | `/cameras/:id/imaging`        | Current imaging settings + the presets/controls the camera supports. | `200`, `404`, `502`, `503`        |
| `POST` | `/cameras/:id/imaging/preset` | Apply a Day / Night-IR / Fog / Glare preset (capability-gated).      | `200`, `400`, `409`, `502`, `503` |

## Discovery & onboarding

| Method | Path                           | Purpose                                                                                                          | Notes                           |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `GET`  | `/cameras/discover`            | Scan the LAN (WS-Discovery + mDNS) for cameras.                                                                  | throttled (~30 s) → `200`/`429` |
| `POST` | `/cameras/discover/introspect` | Zero-typing onboarding: introspect an ONVIF camera (SSRF-guarded; credentials used for the probe are ephemeral). | rate-limited (20/min)           |
| `GET`  | `/cameras/onboarding-hints`    | Curated make/model hints (GoPro, Insta360…).                                                                     | —                               |
| `POST` | `/cameras/test`                | Connection-test an _unsaved_ camera (ffprobe/TCP, SSRF-guarded).                                                 | rate-limited (20/min)           |

## Recording, snapshots & uploads

| Method   | Path                    | Purpose                                                                 | Codes                             |
| -------- | ----------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| `POST`   | `/cameras/:id/record`   | Start/stop continuous recording (`{ active }`). Tier-gated.             | `200`, `404`, `409`, `503`        |
| `GET`    | `/recordings`           | Active recorders + on-disk segments (newest first).                     | `200`, `503`                      |
| `GET`    | `/recordings/:name`     | Stream a segment with HTTP Range.                                       | `200`, `206`, `404`, `416`, `503` |
| `POST`   | `/cameras/:id/snapshot` | Capture a telemetry-stamped still.                                      | `201`, `404`, `502`, `503`        |
| `POST`   | `/videos`               | Upload a video (magic-byte validated, quota-bounded, streamed to disk). | `201`, `400`, `413`, `415`, `503` |
| `GET`    | `/videos`               | List stored videos.                                                     | `200`, `503`                      |
| `GET`    | `/videos/:id`           | Stream a stored video with HTTP Range.                                  | `200`, `206`, `404`, `416`, `503` |
| `DELETE` | `/videos/:id`           | Delete a stored video.                                                  | `204`, `404`, `503`               |

## Safety & awareness

| Method | Path                       | Purpose                                                                                    | Codes                             |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `POST` | `/mob`                     | Activate/deactivate the man-overboard response (`{ active }`). Also a Signal K PUT action. | `200`, `503`                      |
| `POST` | `/cameras/:id/slew-to-cue` | Aim a calibrated PTZ camera at the nearest-CPA AIS target (single aim; re-POST to re-cue). | `200`, `404`, `409`, `502`, `503` |
| `GET`  | `/cameras/layout`          | Role/placement grouping hints for auto-arranging cameras.                                  | `200`, `503`                      |

## Incidents & Frigate clips

| Method   | Path                             | Purpose                                                              | Codes                                    |
| -------- | -------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `POST`   | `/incidents`                     | Trigger an incident bundle (`{ cameras?, preMs?, postMs?, note? }`). | `202`, `400`, `503`                      |
| `GET`    | `/incidents`                     | List bundles (newest first).                                         | `200`, `503`                             |
| `GET`    | `/incidents/:id`                 | Fetch a bundle manifest.                                             | `200`, `400`, `404`, `503`               |
| `GET`    | `/incidents/:id/assets/:assetId` | Stream a bundle asset (clip/snapshot/telemetry) with Range.          | `200`, `206`, `400`, `404`, `416`, `503` |
| `PATCH`  | `/incidents/:id`                 | Edit label / notes / pinned only.                                    | `200`, `400`, `404`, `503`               |
| `DELETE` | `/incidents/:id`                 | Delete a bundle (refuses a pinned one).                              | `204`, `400`, `404`, `409`, `503`        |
| `GET`    | `/frigate/clips`                 | List cached Frigate event clips.                                     | `200`, `503`                             |
| `GET`    | `/frigate/clips/:id`             | Stream a cached clip with Range.                                     | `200`, `206`, `400`, `404`, `416`, `503` |

---

For how these fit together, see the [developer docs](../developers/architecture.md). The routes are
registered in `src/index.ts` and the `register*Routes(...)` functions in each subsystem.
