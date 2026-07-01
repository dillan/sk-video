# Discovery & onboarding

How "Scan" finds cameras, and how the zero-typing flow fills the form in for you. The goal is the biggest possible reduction in helm workload: a boater shouldn't have to hand-type vendor RTSP paths.

---

## The cast

| Piece | File | Role |
| --- | --- | --- |
| Discovery service | `src/discovery/discovery-service.ts` | Runs the probes, dedupes, normalizes, throttles. |
| WS-Discovery probe | `src/discovery/ws-discovery-probe.ts` | ONVIF multicast probe (`resolve:false` — see below). |
| mDNS probe | `src/discovery/mdns-probe.ts` | Bonjour/Avahi service discovery. |
| SSDP probe | `src/discovery/ssdp-probe.ts` | UPnP, strictly device-type-filtered. |
| Normalizer | `src/discovery/normalize.ts` | Raw hits → a uniform candidate shape. |
| Introspect | `src/discovery/onvif-introspect.ts` + `introspect-routes.ts` | Pull device info / profiles / stream + snapshot URIs. |
| Device hints | `src/discovery/device-hints.ts` | Curated make/model hints (GoPro, Insta360…). |
| Placement hints | `src/discovery/placement-hints.ts` | Suggest a friendly name + mount/role from ONVIF scopes. |

---

## Scanning

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant R as /cameras/discover
    participant D as DiscoveryService
    participant N as Network

    B->>R: GET /cameras/discover
    R->>D: scan() (rate-limited ~30s)
    par all probes at once
        D->>N: WS-Discovery multicast
        D->>N: mDNS query
        D->>N: SSDP (device-type filtered)
    end
    N-->>D: raw hits (each blind to the others)
    D->>D: normalize + dedupe by address
    D-->>R: candidates [{xaddr, host, port, ...}]
    R-->>B: 200 candidates
```

Each probe searches a different way and is blind to what the others find — running them together is how you catch a camera one method misses. The scan is **rate-limited**: hammering the network with repeated multicasts is antisocial and slow.

> **Security note that shapes the code:** the WS-Discovery probe runs with `resolve:false`. With `resolve:true`, the ONVIF library would _auto-connect_ to each device's advertised address — a blind SSRF to an attacker-controlled host that bypasses the egress guard. So we parse the raw ProbeMatch ourselves and re-validate the address through the SSRF guard before anything connects. See the [security model](security-model.md).

---

## Zero-typing onboarding

Picking a discovered camera kicks off **introspection**: the plugin connects over ONVIF (with whatever credentials the user typed, used ephemerally), reads the device's own description, and returns a pre-filled, already-validated candidate — source URL, snapshot URI, and capability chips.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant R as /cameras/discover/introspect
    participant S as SSRF guard
    participant O as ONVIF introspect
    participant C as Camera

    B->>R: POST {host, port, username, password}
    R->>S: assertHostAllowed(host)  (resolves + re-checks IPs)
    S-->>R: allowed
    R->>O: connect + getDeviceInformation / getProfiles / getStreamUri / getSnapshotUri
    O->>C: ONVIF calls
    C-->>O: device info, profiles, stream + snapshot URIs
    O->>S: re-validate the returned stream host (DNS-rebind defence)
    O-->>R: enriched candidate (validated source, capability chips)
    R-->>B: 200 — form pre-filled, nothing to type
    Note over R: the credentials are used for the probe and NOT stored here<br/>(the operator saves them explicitly when adding the camera)
```

The address ONVIF hands back (`getStreamUri`) is itself re-validated — a camera can't talk the server into connecting somewhere it shouldn't.

`POST /cameras/discover/introspect` is **auth-gated** on a secured server (`registerIntrospectRoute` is wired with `gate: unauthorized` in `src/index.ts`), on top of being rate-limited and SSRF-guarded — connecting to an operator-supplied host with operator-supplied credentials is an action, not an open probe.

For non-ONVIF cameras, a curated **RTSP-path library** offers likely paths as _suggestions_, gated behind the existing `/cameras/test` probe (which is rate-limited and SSRF-guarded). It's always a suggestion the operator confirms — never authoritative.

### What introspection detects

`probeCapabilities()` (`onvif-controller.ts`) probes each optional feature and treats any error as "unsupported" — capabilities are detected, never assumed. It fills in: PTZ / absolute PTZ, audio + audio backchannel, sub-streams, the **imaging** control names the library actually exposes (`irCut`, `brightness`, `contrast`, `colorSaturation`, `sharpness`, `focus`, `exposure` — the resource validator's vocabulary is kept in sync via `TImagingControl`), the advertised **auxiliary-command** tokens (classified into `spotlight` / `alarm` by `aux-commands.ts`), and the **device info** (`getDeviceInformation` → manufacturer / model / serial / **firmware**, persisted on the resource for a durable identity + change detection). The ONVIF port is not required in the introspect body — the connection layer probes the common ports (see [ONVIF: PTZ & imaging](streaming-pipeline.md#onvif-ptz--imaging)).

### Re-scanning an existing camera

`POST /cameras/:id/rescan` (`rescan-routes.ts`) re-runs introspection for an **already-added** camera using its **stored** credentials and returns the fresh discovery; the client merges it into the resource (`mergeRescan` in the web app; `mergeDiscovered` server-side) — refreshing capabilities/media/device while preserving operator-set fields (name, role, placement, calibration).

On start, `refreshChangedCameras()` (`capability-refresh.ts`) cheaply probes each camera's current firmware and, when it differs from the stored `device.firmware` (including the first run, when none is recorded), runs a full re-scan and re-saves — a best-effort, background pass that backfills capabilities for cameras added before capability discovery existed and self-heals after a camera firmware update. Only changed cameras are re-introspected, so there's no churn otherwise.

---

## A note on the harness

Multicast (WS-Discovery, mDNS) doesn't cross Docker Desktop's bridge on macOS/Windows, so the [e2e harness](../../e2e/README.md) seeds cameras manually there. Unicast ONVIF (PTZ, introspect) works fine over the Docker network with the opt-in virtual ONVIF device.
