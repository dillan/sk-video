# Architecture overview

> **New contributor? Start here.** This page is the map. Once you can see how the pieces fit, the rest of the developer docs zoom into one flow each. None of this assumes you've worked with Signal K or go2rtc before.

SK Video is a **Signal K server plugin** written in TypeScript. `src/index.ts` exports the standard plugin shape:

```ts
export = (app: ServerAPI): Plugin => ({ id, name, schema, start, stop, registerWithRouter, ... })
```

`start()` wires everything up; `stop()` tears it all down. Almost every module is a small, pure, unit-tested piece with its I/O injected — the entrypoint is the thin glue that connects them to the real server, the real go2rtc process, and the real filesystem.

---

## The big picture

Browsers can't open `rtsp://` streams, can't speak ONVIF, and can't find cameras. SK Video does all of that **on the server** and hands the browser something it _can_ play — same-origin, with credentials staying on the boat.

```mermaid
flowchart LR
    subgraph Browser["Browser (KIP Video widget — separate repo)"]
      UI[Video widget]
    end

    subgraph Server["Signal K server (the boat)"]
      subgraph Plugin["SK Video plugin"]
        Routes[HTTP routes<br/>same-origin proxy]
        Gateway[go2rtc gateway<br/>+ process supervisor]
        ONVIF[ONVIF controller<br/>PTZ / imaging]
        Discovery[Discovery<br/>WS-Discovery / mDNS / SSDP]
        Safety[Safety & awareness<br/>MOB / anchor / slew]
        Capture[Recording / snapshots / incidents]
        Bridge[Signal K bridge<br/>deltas / notifications / PUT]
        Stores[(File stores<br/>cameras, creds, videos,<br/>recordings, incidents)]
      end
      SKCore[Signal K core<br/>resources · deltas · self-state]
      go2rtc[[go2rtc child process<br/>loopback only]]
    end

    Cameras[(IP cameras<br/>RTSP / RTMP / ONVIF)]
    Frigate[(Frigate<br/>user-run, optional)]

    UI -- "same-origin HTTPS<br/>/plugins/sk-video/*" --> Routes
    Routes --> Gateway
    Routes --> ONVIF
    Routes --> Discovery
    Routes --> Capture
    Gateway -- "loopback :1984/:8554" --> go2rtc
    go2rtc -- "pulls streams" --> Cameras
    ONVIF -- "PTZ / imaging" --> Cameras
    Discovery -. "scan / introspect" .-> Cameras
    Safety --> Bridge
    Capture --> Stores
    Bridge <--> SKCore
    Frigate -. "MQTT events" .-> Safety
    SKCore -. "cameras resource" .-> UI
```

Two invariants jump out of that diagram, and they're load-bearing:

1. **The browser only ever talks to the plugin.** It never reaches go2rtc (`:1984`) or a camera IP. A client-supplied `src=` is never honored. Everything is proxied by an internal camera id.
2. **go2rtc is bound to loopback.** Only the plugin can reach it.

See the [security model](security-model.md) for the full list of invariants.

---

## Subsystems

Each lives in its own `src/` directory and is mostly independent. The entrypoint composes them.

| Directory | Responsibility | Deep-dive |
| --- | --- | --- |
| `src/gateway/` | Manage the **go2rtc** child process and proxy WebRTC/HLS/MJPEG/frame same-origin; stream health + watchdog. | [Streaming pipeline](streaming-pipeline.md) |
| `src/onvif/` | ONVIF PTZ, imaging presets, spotlight/alarm auxiliary commands, capability probe, port-probing connection, and the re-scan endpoint. | [Streaming pipeline](streaming-pipeline.md) |
| `src/discovery/` | WS-Discovery, mDNS, SSDP; zero-typing introspection; device hints. | [Discovery & onboarding](discovery-and-onboarding.md) |
| `src/cameras/` | The `cameras` resource model + validation, the camera & credential stores, capability merge + firmware-change re-scan. | [Storage & data](storage-and-data.md) |
| `src/recording/` | DVR recording manager + position-stamped snapshots + their stores. | [Storage & data](storage-and-data.md) |
| `src/incidents/` | Event bundles: pre/post-roll clip + telemetry track + snapshots. | [Storage & data](storage-and-data.md) |
| `src/safety/` | Man-overboard, anchor-watch, experimental visual refine, geo math. | [Safety & awareness](safety-and-awareness.md) |
| `src/awareness/` | AIS targets, CPA, slew-to-cue (shares the MOB geo engine). | [Safety & awareness](safety-and-awareness.md) |
| `src/analytics/` | Frigate MQTT client + cached clips. | [Safety & awareness](safety-and-awareness.md) |
| `src/uploads/` | Uploaded-video store, quota, HTTP Range, magic-byte sniff. | [Storage & data](storage-and-data.md) |
| `src/signalk/` | The bridge: deltas, notifications, self-state reads, PUT/action handlers. | this page (below) |
| `src/web/` | The web-app seam: serves the bundled React console under `/app`, the session/whoami probe, the durable event log, web-push (VAPID + subscriptions + fan-out), and the web-app-owned operational config. | this page (below) |
| `src/security/` | SSRF guard, rate limiter, log redaction, timeouts. | [Security model](security-model.md) |
| `src/hardware/` | Tier detection (cores/RAM/arch/accelerator) → feature matrix. | [Hardware & performance](../guides/hardware-and-performance.md) |
| `src/util/` | Small shared helpers (e.g. atomic file writes). | — |

`AGENTS.md` at the repo root has a terser, line-level map if you want to grep your way in.

---

## The Signal K bridge

`src/signalk/sk-bridge.ts` is the one place the plugin touches the Signal K server, so the rest of the code stays testable. It wraps:

- **Deltas** (`app.handleMessage`) — publish values like `navigation.mob.position` and the per-camera health paths (`cameras.<id>.feedOutage/producers/consumers`), plus **meta** (labels, units, optional zones) and **resource-change announcements** (`resources.cameras.<id>`, sent as v2). The full published surface is in the [Signal K surface reference](../reference/signalk-surface.md).
- **Notifications** (`app.notifications.raise/update/clear`) — alarms for MOB, anchor-watch, the camera watchdog (on the camera's own path, `notifications.cameras.<id>.feedOutage`), Frigate. It **feature-detects and degrades**: on a server with no notifications API (or one that throws), it falls back to a `notifications.*` delta instead of taking down a safety path. Acks fall back to a server-side path lookup for zone-raised alarms the bridge didn't create.
- **Self-state reads** (`getSelfPath`/streambundle) — position, heading, SOG, COG, depth, wind — read with their data-age so the code can be honest about stale fixes.
- **PUT/action handlers** (`registerPutHandler`) — e.g. the MOB trigger. These **inherit the server's auth**; there's no unauthenticated safety trigger.

The Signal K API surface varies by server version, so the bridge probes for what's available rather than assuming it.

One newer seam is worth calling out: the bridge takes an **`onNotify` tap** (wired in `src/index.ts`). Every notification it raises is handed to that callback, which **writes the event into the durable event log _and_ fans it out as web-push**. That single hook is how transient Signal K notifications become a retrospective record and a phone alert without each safety path having to know about either.

---

## The web app, event log, and push

`src/web/` is the boundary between the plugin and the first-class console (the web app owns management; the plugin is the thin conduit). It is mostly small, IO-injected modules the entrypoint composes:

- **Serving the app** (`app-routes.ts`) — the built React/Vite bundle in the package's `public/` dir is served same-origin under `/plugins/sk-video/app/`, alongside but never shadowing the HTTP API. Hashed assets are immutable; `index.html` is `no-store`; extension-less paths fall back to the SPA entry; path traversal is rejected so a request can't escape `public/`.
- **Session probe** (`session-routes.ts`) — `GET /session` is an auth-only "whoami" returning booleans (security enabled? this request authenticated?) plus the plugin version, so the app can decide whether to show sign-in UI without leaking a token.
- **Durable event log** (`event-log.ts`, `event-log-routes.ts`) — an append-only record of safety/system events (MOB, incident, anchor drag, camera-offline). Notifications vanish when cleared; this log is how "reconstruct what happened last night" becomes real. `GET /events/log` reads it newest-first; the bridge tap owns writes.
- **Web-push** (`vapid.ts`, `push-store.ts`, `push-sender.ts`, `push-events.ts`, `push-routes.ts`) — a stable VAPID keypair (persisted, never rotated, since a browser's subscription is bound to the key it subscribed with), an owner-only subscription store, a best-effort fan-out that prunes dead endpoints (404/410) and never lets a push failure touch the safety path, and the shaping that turns an alerting event into a tappable notification. The Pi only makes outbound requests to the browser's push service.
- **Operational config** (`operational-config.ts`, `config-routes.ts`) — settings the web app owns instead of the Signal K admin form (hardware tier, trigger/anchor paths, Frigate MQTT). `GET/PUT /operational-config` validate + merge (the write-only Frigate password is redacted on read, preserved on write) and apply via the server's **`restart()` contract** — persist the options, then stop/start to re-wire MQTT, delta subscriptions, and timers. The path is `/operational-config`, not `/config`, because signalk-server itself owns `/plugins/:id/config`.

### Bundled front-end and PWA

The console lives in a `webapp/` sub-project (its own npm package, built with `npm --prefix webapp run build`) whose output is the package's `public/` dir — the hashed `assets/`, `index.html`, `manifest.webmanifest`, icons, and a PWA service worker (`webapp/public/sw.js`). It's served read-only and same-origin under `/app`.

The plugin is also registered as a **Signal K webapp**: the `signalk-webapp` keyword plus `signalk.displayName`/`appIcon` in `package.json` make it appear at `/sk-video/` in the server's Webapps menu, so an operator can reach the console straight from Signal K.

---

## Lifecycle: start and stop

`start()` builds the subsystems and registers routes; `stop()` must put everything back exactly. Getting teardown right matters on a boat that reloads the plugin on every config change — a leaked timer, child process, or subscription would survive a reload and double-fire.

```mermaid
flowchart TD
    A[Signal K calls start] --> B[detect hardware tier]
    B --> C[create stores: cameras, credentials, videos,<br/>recordings, FileSnapshotStore snapshots, incidents,<br/>EventLog, PushStore + VAPID keys]
    C --> D[build SignalKBridge with onNotify tap<br/>→ event log + web-push fan-out]
    D --> E[create go2rtc gateway + binary manager + supervisor]
    E --> F[create MOB / watch / slew / Frigate / incidents]
    F --> G[registerWithRouter: all HTTP routes]
    G --> H[register cameras resource provider + PUT actions]
    H --> I[scheduleSync → start go2rtc if cameras exist]

    Z[Signal K calls stop] --> Y[clear every timer + interval]
    Y --> X[end MQTT, stop watchdog, cancel incidents]
    X --> W[deactivate MOB, stop recorders]
    W --> V[gateway.stop → kill go2rtc, await exit]
    V --> U[null every handle so nothing fires post-stop]
```

go2rtc's own supervisor is a small state machine of its own — see the lifecycle diagram in [the streaming pipeline](streaming-pipeline.md#go2rtc-process-lifecycle).

---

## How to read the rest of the docs

- Want to know how a camera becomes a picture? → [Streaming pipeline](streaming-pipeline.md)
- Curious about MOB / AIS pointing? → [Safety & awareness](safety-and-awareness.md)
- How does "scan" work? → [Discovery & onboarding](discovery-and-onboarding.md)
- What must every change keep true? → [Security model](security-model.md)
- Where does data live and how can a full disk _not_ brick the server? → [Storage & data](storage-and-data.md)
