# Streaming pipeline

How an `rtsp://` camera becomes browser-playable video — the single most important flow in the plugin.

The job: browsers can play WebRTC, HLS, and MJPEG, but not the RTSP/RTMP streams cameras produce. SK Video runs **[go2rtc](https://github.com/AlexxIT/go2rtc)** as a child process to do the repackaging, and proxies the browser-facing transports same-origin so credentials never leave the server.

---

## The cast

| Piece | File(s) | Role |
| --- | --- | --- |
| **Gateway** | `src/gateway/go2rtc-gateway.ts` | Reconciles go2rtc's config with the configured cameras. |
| **Config builder** | `src/gateway/go2rtc-config.ts` | Turns cameras + credentials into go2rtc's `streams` config (loopback ports only). |
| **Binary manager** | `src/gateway/go2rtc-binary-manager.ts` | Downloads the pinned go2rtc binary once (atomic install, optional SHA pin). |
| **Process supervisor** | `src/gateway/go2rtc-process.ts` | Spawns/restarts/stops go2rtc; serialized so a restart can't orphan a port-holding process. |
| **Proxy routes** | `src/gateway/go2rtc-proxy-routes.ts` | The same-origin WHEP/HLS/frame/talk/health/transport endpoints. |
| **Stream health** | `src/gateway/stream-health.ts` | Reads go2rtc's `/api/streams` into a redacted DTO. |
| **Watchdog** | `src/gateway/stream-watchdog.ts` | Debounced "safety-critical camera went dark" alarm. |

---

## Adding a camera → go2rtc gets configured

When a camera resource is written, the plugin re-derives go2rtc's config and (re)starts it. The sync is **debounced and serialized** so a burst of edits collapses into one reconcile and two reconciles never run at once.

```mermaid
sequenceDiagram
    autonumber
    participant W as Widget / Resources API
    participant R as Resource provider (index.ts)
    participant G as Go2rtcGateway
    participant P as Go2rtcProcess
    participant X as go2rtc child

    W->>R: PUT /resources/cameras/foredeck
    R->>R: validateCamera() + SSRF-guard host
    Note over R: source changed? drop stored credentials
    R->>G: scheduleSync() (debounced 500ms)
    G->>G: buildGo2rtcConfig(cameras, credentials)
    Note over G: streams keyed by camera id,<br/>bound to loopback :1984/:8554
    G->>P: running? restart : start
    P->>X: spawn / SIGTERM+respawn
    X-->>P: connects to the camera lazily
```

The browser is never part of this — it just gets an internal camera **id** to ask for.

---

## Watching a camera (WebRTC / HLS)

The browser asks the plugin, the plugin asks go2rtc on loopback, and the answer comes back. The camera id is the only thing the browser knows; a client-supplied `src=` is never honored.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant R as Proxy routes
    participant X as go2rtc (loopback)
    participant C as Camera

    rect rgb(238,246,255)
    note over B,X: Low-latency path — WebRTC (WHEP)
    B->>R: POST /cameras/foredeck/whep (SDP offer)
    R->>X: POST /api/webrtc?src=foredeck (offer)
    X->>C: pull RTSP, negotiate
    X-->>R: SDP answer
    R-->>B: SDP answer (same-origin)
    B->>X: media flows both ways (still via the boat, never direct)
    end

    rect rgb(240,255,240)
    note over B,X: Standard path — HLS
    B->>R: GET /cameras/foredeck/stream.m3u8
    R->>X: GET /api/stream.m3u8?src=foredeck
    X-->>R: master playlist (relative URLs)
    R-->>B: playlist
    B->>R: GET /cameras/foredeck/hls/segment_3.ts
    R->>X: proxied
    X-->>B: segment
    end
```

Every loopback fetch carries a **timeout** so a stalled go2rtc can't hang a proxy handler, and the SDP body read is **size-capped** so a client can't stream an unbounded body into memory.

---

## Picking a transport: the fallback walk

`GET /cameras/:id/transport` returns a codec-aware ordering the viewing app can walk down on a bad link and back up when it recovers. There's no server-side transcoding — the order just reflects what's most likely to play.

```mermaid
flowchart TD
    Start([Widget needs to show camera]) --> Health{Ask /transport}
    Health --> Codec{H.265 stream?}
    Codec -- "no (H.264)" --> WebRTC[Try WebRTC<br/>low latency]
    Codec -- "yes" --> HLS1[Try HLS first<br/>WebRTC H.265 is spotty]
    WebRTC -- ok --> Play([Playing])
    WebRTC -- starved --> HLS2[Fall back to HLS]
    HLS1 -- ok --> Play
    HLS2 -- ok --> Play
    HLS1 -- starved --> MJPEG[Still-refresh MJPEG<br/>a frame every 1–2s]
    HLS2 -- starved --> MJPEG
    MJPEG --> Recover{Link recovered?}
    Recover -- yes --> WebRTC
    Recover -- no --> MJPEG
```

The walk UX lives in the widget; the plugin only publishes the recommendation + a frame-friendly `Cache-Control: no-store` on the still frame.

---

## go2rtc process lifecycle

The supervisor (`go2rtc-process.ts`) is a small state machine. The hard-won detail: **all** start / restart / stop work is serialized through one promise chain and gated by a `closed` flag, so a restart that's in flight when the plugin tears down can't spawn a fresh go2rtc that outlives `stop()` and keeps holding the loopback ports.

```mermaid
stateDiagram-v2
    [*] --> Stopped
    Stopped --> Running: start() → spawn
    Running --> Running: restart() → SIGTERM, respawn (serialized)
    Running --> Stopped: stop() → closed=true, SIGTERM/SIGKILL, await exit
    Running --> Crashed: unexpected exit
    Crashed --> Running: auto-restart (capped backoff)
    Crashed --> GaveUp: too many crashes
    GaveUp --> Running: next config change
    note right of Running
      both stdio pipes drained
      (an unread stdout pipe fills
      and deadlocks go2rtc)
    end note
```

---

## ONVIF: PTZ & imaging

PTZ and imaging are a separate path — they talk ONVIF to the camera directly (server-side), not through go2rtc.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant R as PTZ/imaging routes
    participant M as PtzManager (cache)
    participant O as OnvifController
    participant C as Camera (ONVIF)

    B->>R: POST /cameras/foredeck/ptz (pan, tilt, zoom)
    R->>R: validate + velocity-clamp
    R->>M: controllerFor(id)
    M->>O: cached connection (SSRF-guarded host)
    O->>C: continuousMove(...)
    Note over R,O: a runaway move auto-stops,<br/>absolute moves are clamped to +/-1
```

`PtzManager` caches one controller per camera and re-validates the host through the SSRF guard. Imaging presets (Day/Night/Fog/Glare) are capability-gated — the route only applies a control the camera actually reports.

---

## Where to look next

- The proxy's same-origin and credential rules: [Security model](security-model.md).
- How the geo features reuse absolute PTZ: [Safety & awareness](safety-and-awareness.md).
