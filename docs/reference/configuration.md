# Settings & configuration reference

SK Video's operational settings live in the **SK Video app**, under **Settings → Operational** — not on the Signal K admin page. The Signal K **Server → Plugin Config → SK Video** form only switches the plugin **on or off**; it has no fields to fill in.

> **Moved from the admin form.** Earlier versions kept these on the plugin-config page. They now live in the app so the Signal K admin stays clean and one console owns the whole setup. The plugin auto-detects your hardware tier; you can override it under **Settings → Operational → Advanced**.

Cameras are **not** configured here — they're managed under **Cameras** in the app (and saved as shared Signal K resources). See [Adding cameras](../guides/cameras.md).

---

## Settings → Operational

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| **Hardware tier** (Advanced) | `auto`, `minimal`, `pi4`, `accelerated`, `x86` | `auto` | Leave on **Auto-detect** unless the detected tier is wrong. Controls which heavier features (recording, hardware snapshots, on-device analytics) are offered. See [Hardware & performance](../guides/hardware-and-performance.md). |
| **Incident auto-trigger path** | string | `""` (off) | A Signal K notification subtree to auto-capture an [incident bundle](../guides/advanced.md#incident-bundles) from (e.g. `notifications.*`). Fires only on alert/alarm/emergency and is best-effort. Leave blank — the manual "mark incident" trigger is the reliable path. |
| **Anchor/geofence watch path** | string | `notifications.navigation.anchor` | The notification path to watch for an anchor-drag/geofence alarm. On an alarm it auto-captures evidence on your anchor/security-role cameras and raises one consolidated notification. It _consumes_ an alarm you already produce — it doesn't compute drag itself. Blank to disable. See [Safety features](../guides/safety.md#anchor-watch-evidence). |
| **Experimental visual MOB refine** | boolean | `false` (off) | During a man-overboard event, lets a Frigate person detection add a small, bounded visual correction _on top of_ the authoritative position-based aim. Fails safe (reverts on track loss). Requires Frigate, refines only a calibrated PTZ camera whose id matches its Frigate camera name. **NOT safety-rated.** See [Safety features](../guides/safety.md#experimental-visual-refine-off-by-default). |

### Frigate (your own instance)

Connect to **your own** [Frigate](../guides/advanced.md#frigate-motion-alerts) broker to surface its person/car/boat detections as notifications + cached clips. Frigate is never bundled; detection is close-range COCO-class only.

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| **MQTT host** | string | `""` (off) | The broker hostname/IP. Blank disables Frigate. |
| **MQTT port** | number (1–65535) | `1883` | Broker port. |
| **Use TLS (mqtts)** | boolean | `false` | Connect with `mqtts://` instead of `mqtt://`. |
| **MQTT username** | string | `""` | Broker login, if required. |
| **MQTT password** | string (write-only) | — | Broker password. **Write-only:** it's never shown back — the field shows whether one is stored, and leaving it blank keeps the current one. |
| **HTTP API URL** | string | `""` | Frigate's HTTP API base (e.g. `http://192.168.1.10:5000`) for fetching an event clip. Must be `http(s)://`; SSRF-guarded. Blank = notifications only, no clip caching. |
| **Alert labels** | string | `person,car` | Comma-separated object labels that count as an alert. |
| **Minimum score** | number (0–1) | `0.7` | Minimum detection confidence to alert on (clamped to 0–1). |
| **Zones** | string | `""` (any) | Comma-separated Frigate zones an object must enter to alert. Blank = any zone. |

---

## Notes

- **Saving briefly restarts the plugin.** Applying operational settings re-wires the MQTT connection, notification subscriptions and timers, so live video reconnects for a few seconds. The app warns you.
- **Two write-only secrets, handled the same way.** Camera logins and the Frigate broker password are both accepted on save, never returned, and redacted from logs. See [Adding cameras](../guides/cameras.md#camera-logins).
- **Theme and density** (Day/Dark/Night-Red, Helm/Desk) and the **Safety alerts** opt-in are also in **Settings**, but they're per-device preferences, not boat-wide operational config.
- **Retention is fixed** (rolling buffer ~10 GiB / 48 h, ~2000 snapshots) — read-only, by design. This is an operator console, not a 24/7 NVR.

## For developers

The settings above are read and written over a same-origin HTTP contract, not the Signal K plugin schema (which is empty):

- `GET /plugins/sk-video/operational-config` — current config, Frigate password redacted to a `mqttPasswordSet` flag.
- `PUT /plugins/sk-video/operational-config` — validate (closed key-set) + merge (preserving the write-only password) + persist + restart to apply.

The typed shape is `IOperationalConfig` in `src/web/operational-config.ts`; the route is `src/web/config-routes.ts`. See the [HTTP API reference](http-api.md).
