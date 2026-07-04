# The Signal K surface

Everything sk-video publishes into (and accepts from) the Signal K data model, so any client — KIP, an instrument display, your own script — can use the cameras without knowing sk-video's private HTTP API. This is the contract; the [HTTP API](http-api.md) is the plugin's own console surface.

## Camera health paths (published every poll, ~15 s)

For every **enabled** camera, under `vessels.self`:

| Path | Value | Meta |
| --- | --- | --- |
| `cameras.<id>.feedOutage` | Seconds since the feed was last confirmed healthy. `0` while healthy; absent until first seen online. Published only for **watched** cameras (safety-critical or zones-enabled) — those are actively probed each poll, so "idle" and "dead" read apart. | `displayName`, `units: 's'`, `timeout`, optional `zones` |
| `cameras.<id>.producers` | Active source connections in the gateway. | `displayName` |
| `cameras.<id>.consumers` | Clients currently pulling the stream. | `displayName` |

The gauge inherits the watchdog's debounce: one healthy blip during an outage does not reset it, and the last-good stamp is persisted, so an outage that spans a plugin/server restart still shows (and still alarms). Labels ride `setDefaultMetadata` on servers ≥ 2.30, so a displayName you edit on the server is never overwritten.

## Camera alarms — `notifications.cameras.<id>.*`

All alarms about a camera live under one subscribable subtree:

- `notifications.cameras.<id>.feedOutage` — the camera-dark alarm (state `alarm`), raised by the plugin's debounced watchdog for cameras marked **safety critical**. Mirrors the gauge path.
- `notifications.cameras.<id>.detections.<label>` — detections (state `alert`) from a user-run Frigate whose camera name matches one of ours (by id or display name — never guessed). Carries `data.cameraId` for deep-linking.

Acknowledging through the app (or `POST /plugins/sk-video/notifications/ack` with the key, e.g. `cameras.bow.feedOutage`) silences the alarm **shared-state** — every client sees it quiet.

**Zones opt-in.** In the app under _Settings → Operational → Camera health alarms_ you can hand a camera's alarm to the Signal K server itself: the warn/alarm thresholds become standard `meta.zones` on the gauge, and the **server's** zone watcher raises the very same notification path (so zone-aware instruments render the state natively). One alarm authority per camera, always: with zones on, the plugin's watchdog stands down for that camera; turning zones off (or disabling/deleting the camera) disarms the server watcher explicitly.

## Writable camera controls (standard Signal K PUT)

Discoverable via `meta.supportsPut: true`; the server's own authorisation applies.

| Path | Value | Exists when |
| --- | --- | --- |
| `cameras.<id>.spotlight` | `true` / `false` | the camera advertised a spotlight |
| `cameras.<id>.recording` | `true` / `false` | this install can record (409-style failure when the tier refuses a channel) |
| `cameras.<id>.activePreset` | preset token | the camera has PTZ |
| `cameras.mob.activate` | `true` / `false` | always — the MOB trigger |
| `cameras.incident.mark` | (see HTTP API) | always |

A KIP boolean-switch widget can flip the spotlight or recording, and a multi-state widget can recall presets, with zero sk-video-specific configuration. Continuous PTZ jog deliberately stays on the [HTTP API](http-api.md) — a joystick is not a PUT.

## Resources

- **`cameras`** (custom type) at `/signalk/v2/api/resources/cameras` — the camera definitions, full CRUD. Never contains credentials. Property drill-down works (`GET …/cameras/<id>/source/scheme`).
- **`incidents`** at `/signalk/v2/api/resources/incidents` — read-mostly evidence bundles.

Every change — API writes _and_ internal ones (auto re-scan, calibration, pruning) — is announced as a delta on `resources.cameras.<id>` / `resources.incidents.<id>` (the document as the value, `null` when deleted), so a subscribed client's list converges without polling.

## Other paths

- `navigation.mob.position` — the MOB marker while a man-overboard response is active.
- `notifications.sk-video.*` — vessel-scoped events that are not about one camera: `mob` (emergency), `incident`, `anchorWatch`, and detections from Frigate cameras we could not map.

## Server compatibility

Everything is feature-detected and degrades: full notification lifecycle needs signalk-server ≥ 2.28; polite metadata defaults use ≥ 2.30; on older/partial servers alarms fall back to plain `notifications.*` deltas and labels to plain meta deltas. The plugin's HTTP contract is published as OpenAPI in the server Admin UI under **Documentation → OpenAPI**.
