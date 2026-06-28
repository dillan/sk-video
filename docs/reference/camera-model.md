# Camera model reference

A camera is stored as a Signal K **resource** of type `cameras`, at
`/signalk/v2/api/resources/cameras/{id}`. This page lists every field, its allowed values, and whether
_you_ set it or the _server_ fills it in.

> **Credentials are never part of this resource.** Logins are stored separately and write-only. See
> [Adding cameras](../guides/cameras.md#camera-logins).

The field set is **closed** and strictly validated — an unknown field, or a credential-looking field,
is rejected. This is a security control, not pedantry: it keeps secrets out of the shared resource and
blocks injection. All fields except `name`, `enabled`, and `source` are optional.

---

## Core fields

| Field     | Type    | Allowed values              | Set by |
| --------- | ------- | --------------------------- | ------ |
| `name`    | string  | 1–100 characters            | you    |
| `enabled` | boolean | `true` / `false`            | you    |
| `source`  | object  | the stream endpoint (below) | you    |

### `source`

| Field    | Type              | Allowed values                                    | Notes                                                                            |
| -------- | ----------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `scheme` | enum              | `rtsp`, `rtsps`, `rtmp`, `http`, `https`, `onvif` | Scheme **allow-list** — `exec:`/`ffmpeg:`/`pipe:` and anything else are blocked. |
| `host`   | string            | hostname / IPv4 / IPv6 (`[A-Za-z0-9._:-]+`)       | The destination is re-checked by the SSRF guard before any connection.           |
| `port`   | number (optional) | 1–65535                                           | Blank uses the scheme default.                                                   |
| `path`   | string (optional) | safe absolute path; no `..`                       | The stream path.                                                                 |

---

## Placement & role (you set these; they unlock smart features)

| Field                          | Type    | Allowed values                                                                                                                            |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `placement.mount`              | enum    | `bow`, `stern`, `port`, `starboard`, `mast`, `spreader`, `cockpit`, `helm`, `deck`, `cabin`, `engine`, `transom`, `radararch`, `interior` |
| `placement.bearingRelativeDeg` | number  | 0–360 (clockwise from the bow; 0 = forward)                                                                                               |
| `placement.heightM`            | number  | 0–100 (metres above the water)                                                                                                            |
| `role`                         | enum    | `navigation`, `docking`, `anchor`, `security`, `engine`, `deck`, `cockpit`, `helm`, `general`                                             |
| `safetyCritical`               | boolean | `true` to have the [watchdog](../guides/safety.md#camera-watchdog) alarm if this camera goes dark                                         |
| `allowSelfSigned`              | boolean | `true` to trust a self-signed TLS cert on an ONVIF-over-HTTPS camera (per-camera, explicit)                                               |

---

## Capabilities (server-written — never trusted from a client)

Filled in by the server when it introspects a camera over ONVIF. These describe what the camera can
actually do; an app reads them to decide which controls to show.

| Field                           | Type     | Meaning                                                                                      |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `capabilities.ptz`              | boolean  | Pan/tilt/zoom supported.                                                                     |
| `capabilities.absolutePtz`      | boolean  | Absolute positioning — required for geo-pointing (MOB, AIS slew).                            |
| `capabilities.audio`            | boolean  | Audio input available.                                                                       |
| `capabilities.audioBackchannel` | boolean  | Two-way audio (a speaker/output) — enables [hailing](../guides/advanced.md#two-way-audio).   |
| `capabilities.substreams`       | boolean  | A low-res sub-stream variant exists.                                                         |
| `capabilities.imaging`          | string[] | Imaging controls present: any of `irCut`, `wdr`, `defog`, `focus`, `brightness`, `exposure`. |

---

## Media & calibration

| Field                 | Type   | Allowed values                                          | Notes                                                                                        |
| --------------------- | ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `media.codec`         | enum   | `h264`, `h265`, `mjpeg`                                 | Helps the app choose a playback strategy.                                                    |
| `media.profileToken`  | string | ONVIF token charset, ≤64 chars                          | The ONVIF profile to use.                                                                    |
| `media.substreamPath` | string | safe path                                               | The low-res variant's path.                                                                  |
| `media.projection`    | enum   | `standard`, `equirectangular`, `fisheye`, `dualfisheye` | 360/panoramic projection. The browser renders the virtual-PTZ; the **server never dewarps**. |
| `calibration.pan`     | object | `{ offset, scalePerDeg }` (finite numbers)              | Maps a bearing in degrees to the camera's normalized pan units.                              |
| `calibration.tilt`    | object | `{ offset, scalePerDeg }` (finite numbers)              | The same for tilt.                                                                           |

`calibration` is what lets the geo-pointing features (man-overboard, AIS slew-to-cue) aim an
absolute-PTZ camera at a real-world position. Without it, the camera can be nudged but not pointed at a
target.

---

## Example

A fully-described foredeck PTZ camera (credentials are set separately, not here):

```json
{
  "name": "Foredeck",
  "enabled": true,
  "source": { "scheme": "rtsp", "host": "192.168.1.50", "port": 554, "path": "/stream1" },
  "placement": { "mount": "mast", "bearingRelativeDeg": 0, "heightM": 8 },
  "role": "navigation",
  "safetyCritical": true,
  "capabilities": { "ptz": true, "absolutePtz": true, "imaging": ["irCut", "wdr"] },
  "media": { "codec": "h264", "substreamPath": "/stream2" },
  "calibration": {
    "pan": { "offset": 0, "scalePerDeg": 0.0111 },
    "tilt": { "offset": 0, "scalePerDeg": 0.0222 }
  }
}
```

The authoritative definition lives in `src/cameras/camera-validation.ts`.
