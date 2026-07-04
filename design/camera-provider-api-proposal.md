# Proposal: a Camera Provider API for Signal K Server

_Draft for discussion with the Signal K project (SignalK/signalk-server). Written from the experience of building [sk-video](https://github.com/dillan/sk-video), which ships the patterns below today inside a plugin and would migrate to a server-owned API the moment one exists._

## Why

Boats increasingly carry IP cameras, and they are devices in exactly the sense the v2 REST APIs already anticipate — the API Conventions doc says it directly: "When an API supports the installation of multiple devices _(e.g. autopilots, radars, etc)_…". Radar got a provider registry (`registerRadarProvider`, shipped in `@signalk/server-api` since 2.28); autopilot has one; cameras have nothing, so every camera plugin invents a private surface and no generic client (KIP, Freeboard, instrument displays) can rely on anything.

sk-video currently approximates a camera API with the stable primitives available today:

- camera definitions as a **custom `cameras` resource** (Resources API),
- per-camera health as **v1 deltas** on `cameras.<id>.*` with meta (units, timeout, optional zones so the server's own zone watcher raises `notifications.cameras.<id>.feedOutage`),
- curated writable controls as **PUT paths with `supportsPut` meta** (`cameras.<id>.spotlight` / `.recording` / `.activePreset`),
- a **capability manifest** per camera (features, typed controls, relative stream URLs) on its plugin routes, published via `getOpenApi`.

That works, but it is a convention, not a contract. This proposal is the contract.

## Shape (deliberately parallel to the shipped `RadarProvider`)

```ts
interface CameraProvider {
  name: string; // provider/plugin label
  methods: CameraProviderMethods;
}

interface CameraProviderMethods {
  // REQUIRED — enumerate + describe, exactly like RadarProviderMethods
  getCameras(): Promise<string[]>;
  getCameraInfo(cameraId: string): Promise<CameraInfo | null>;

  // OPTIONAL — a fixed deck camera has almost none of these. Missing method ⇒ HTTP 501
  // {state:'FAILED'} (the radar implementation's idiom; NOT autopilot's implement-and-throw).
  getCapabilities?(cameraId: string): Promise<CameraCapabilityManifest>;
  getControls?(cameraId: string): Promise<Record<string, ControlValue>>;
  setControl?(cameraId: string, controlId: string, value: ControlValue): Promise<void>;
  ptzMove?(cameraId: string, move: PtzMove): Promise<void>;
  ptzStop?(cameraId: string): Promise<void>;
  gotoPreset?(cameraId: string, presetToken: string): Promise<void>;
  takeSnapshot?(cameraId: string): Promise<SnapshotRef>;
  setRecording?(cameraId: string, on: boolean): Promise<void>;
}

interface CameraInfo {
  id: string;
  name: string;
  status: 'streaming' | 'idle' | 'connecting' | 'stalled' | 'offline';
  make?: string;
  model?: string;
  capabilities?: CameraCapabilityManifest;
  /**
   * Playback endpoints. Relative URLs mean "this server" (survives EXTERNALHOST / TLS
   * termination / reverse proxies); absent ⇒ the provider streams through the built-in
   * endpoint (radar's exact streamUrl semantics, adapted to media).
   */
  streams?: { webrtc?: string; hls?: string; mjpeg?: string };
}
```

`CameraCapabilityManifest` follows radar's capabilities-driven-UI design: hardware traits plus a `controls` map of typed descriptors (`dataType: boolean|number|string|enum|button`, min/max/step, SI units out / friendly units in, `isReadOnly` for identity fields like `firmwareVersion`, and a live `available` flag per control — autopilot's "actions … and their availability in the current state of operation" idiom, so clients can trim their UI).

## Routes

```
/signalk/v2/api/vessels/self/cameras
├── GET                       → { "<id>": { provider, isDefault, ...CameraInfo } }
├── /_providers               → registered camera providers (GET; _default GET/POST)
├── /_default/...             → operations on the designated default camera
└── /{id}
    ├── GET                   → CameraInfo (Cache-Control: no-cache — device state changes)
    ├── /capabilities  GET    → CameraCapabilityManifest ("fetch once per session")
    ├── /controls      GET    → current values;  /controls/{controlId} GET/PUT
    ├── /ptz           PUT    → move;  /ptz DELETE → stop;  /presets/{token} POST
    ├── /snapshot      POST   → one still
    └── /recording     PUT    → { value: boolean }
```

Conventions carried over verbatim: `_default` device targeting, `_providers` selection, the `{state, statusCode, message}` response envelope, buttons take an empty PUT body, optional feature areas answer **501** (note: the server's shared `Responses.notImplemented` template is 500 today — radar hand-rolls its 501; the shared template should probably gain a real 501).

## Data model & notifications (the part clients get "for free")

Like the Course API, every state change is also published as deltas so plain subscribers never poll:

- `cameras.<id>.feedOutage` (seconds, `units: 's'`, meta `timeout`) — a numeric gauge chosen deliberately: the server's zone watcher evaluates **numeric** values only, so a camera with `meta.zones` raises/clears `notifications.cameras.<id>.feedOutage` with **zero camera-specific code anywhere**. Device id lives **in the path** (radar style), not in `$source` (autopilot style) — per-device notification leaves require it.
- `cameras.<id>.producers` / `.consumers` — stream fan-in/out counts.
- Detections/events: `notifications.cameras.<id>.detections.<label>`.
- Emit as **v1 deltas**: v2-structured deltas currently do not land in the full model ("…they do not end up in the full model" — Developing.md), and clients discover paths from the full model.

Camera _definitions_ (user-entered config) stay in the Resources API as the custom `cameras` type — registry CRUD is a resources problem the server already solves, including change deltas with null tombstones.

## Security notes from the reference implementation

- Camera credentials must never appear in `CameraInfo`, manifests, stream URLs, or deltas. sk-video keeps them in a write-only store; the proposal should say so normatively.
- Relative stream URLs + server-side proxying keep the browser same-origin and the camera network unreachable from clients; a client-supplied source URL must never be honoured.
- PUT/command routes inherit the server's authorisation (radar already does `securityStrategy.shouldAllowPut(request, 'vessels.self', null, 'radar')` — cameras would use a `'cameras'` scope).

## Two upstream bugs/gaps found while building this

1. **Docs**: `resource_provider_plugins.md`'s client-subscription example says `"context": "resources"` — but `buildDeltaMsg` in `src/api/resources/index.ts` sets **no** context, so `handleMessage` stamps `vessels.<selfId>` and a subscription written per the example matches nothing. The example should subscribe under the self context.
2. **Envelope**: the shared `Responses.notImplemented` is `statusCode: 500` while the radar routes (correctly) answer 501 for unimplemented optional provider methods — worth unifying before a third device API copies one of them.

## Migration story

sk-video would register as the first `CameraProvider` and delete its private equivalents route by route. Everything above is already exercised in production shape by the plugin (deltas, zone alarms, PUT controls, manifest, OpenAPI), so the API can be evaluated against a running implementation rather than on paper. Like the Radar API, this could version itself with semver independently of the server ("This is version vX.Y.Z of the API…") while it stabilises.
