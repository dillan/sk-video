# Manual camera onboarding + sensor & geolocation model

_Adds a plain-language manual (non-ONVIF) onboarding path, a persisted sensor-capability declaration (compass bearing), and a persisted camera geolocation — all verified against the current code._

---

## Context (verified)

**A field-by-field manual builder already exists** — the wizard's `stream` step (`plainStream()` in `CameraWizard.tsx`) collects scheme (rtsp/rtsps/rtmp/http/https) + address/port/path + credentials and tests the stream before saving. But it is reached through a button labelled _"Paste a stream URL (rtsp:// or rtmp://…)"_ and speaks in jargon (`rtsp`, "Stream path", `/stream1`) — not something a non-technical operator can reason about. The backend already supports non-ONVIF cameras end-to-end: `persistCamera()` validates + SSRF-checks + syncs go2rtc, credentials live in a separate 0o600 store, and ONVIF probing is skipped whenever `source.scheme !== 'onvif'` (`rescan-routes.ts:43`, `capability-refresh.ts:38`). So manual onboarding is mostly a **framing + copy** problem, not new plumbing.

**Two genuinely new model additions, both manual-entry:**

- The installed `onvif@0.8.1` has **zero** geolocation/GPS/sensor methods (121 `Cam` methods, none geo — grep-verified). So neither a camera's geolocation nor its sensors can be probed today; both are operator-declared, modelled forward-compatibly with the ONVIF Device `GeoLocation` concept.
- Capabilities already round-trip through the client (`toResourceBody` sends `capabilities`; `validateCapabilities` gates the shape), so an operator-declared `sensors` list fits the existing pattern exactly, mirroring `imaging`.

**Hard constraint (safety):** `mob-geo.ts:computeAim()` and slew read **only** `placement.bearingRelativeDeg`. Geolocation is a **pure model addition** — it must not touch aiming math, and `geolocation` (absolute) must stay distinct from `placement` (vessel-relative).

---

## Scope

1. **Manual onboarding, plain language.** Reframe the plain-stream path as an explicit, guided _"Set it up manually"_ option a non-technical user can follow, in words not scheme-codes. No new backend. Copy is reviewed with the ux-writing skill.
2. **Sensor capability.** `capabilities.sensors: TCameraSensor[]` (closed enum, starts with `bearing`), an operator declaration ("this camera reports a compass bearing"), persisted + surfaced (badge + SK `supportedFeatures`). A capability _declaration_, not a live reading — we can't read the value over ONVIF 0.8.1, so no value is emitted (forward-looking model data).
3. **Geolocation.** New top-level `ICamera.geolocation = { latitude, longitude, elevationM?, orientationDeg? }`, manual entry, framed for a **fixed / shore-mounted** camera (a boat-mounted camera moves with the vessel, so an absolute position is only meaningful for a fixed install). Bounded validation; does **not** change aiming.

**Explicitly out of scope (noted, not built):** a user-declared codec picker for manual cameras. A wrong declaration would break playback (worse than today's MJPEG-still fallback, which at least works); proper handling is a go2rtc-probed follow-up, not an operator guess. Live ONVIF geolocation / sensor probing awaits an `onvif` lib upgrade.

---

## Model additions (backend, `src/cameras/camera-validation.ts`)

```ts
// Sensor types a camera can report. Closed enum (like IMAGING_CONTROLS); extensible.
export const CAMERA_SENSORS = ['bearing'] as const;
export type TCameraSensor = (typeof CAMERA_SENSORS)[number];

// ICameraCapabilities gains:
sensors?: TCameraSensor[];

// New — an absolute geographic fix for a FIXED-position camera (ONVIF Device GeoLocation shape).
// Distinct from ICameraPlacement (which is vessel-relative). Never used by aiming math today.
export interface ICameraGeolocation {
  latitude: number;    // WGS84, -90..90
  longitude: number;   // WGS84, -180..180
  elevationM?: number; // metres above sea level, -100..10000
  orientationDeg?: number; // the camera's absolute bearing, 0..360 (0 = north)
}
// ICamera gains: geolocation?: ICameraGeolocation
```

Validation, mirroring the existing per-section validators:

- `CAPABILITY_KEYS` += `'sensors'`; validate `sensors` as a list of `CAMERA_SENSORS` (mirror `imaging`).
- `ALLOWED_TOP_KEYS` += `'geolocation'`; add `GEOLOCATION_KEYS`; `validateGeolocation` with bounds (lat/lon/elev/orientation) requiring **both** latitude and longitude when present; wire into `validateCamera` + the assembled `value`.

Merge preservation:

- `camera-merge.ts:mergeDiscovered` rebuilds `capabilities` fresh from the ONVIF probe, so it would drop operator-declared `sensors` on a firmware rescan → **explicitly carry `existing.capabilities .sensors` forward** (sensors are operator-set, never discovered). `geolocation` is top-level and survives via the existing `...existing` spread (like `placement`/`calibration`).
- Webapp `onboard.ts:mergeRescan` has the same shape → preserve `existing.capabilities?.sensors` too.

SK manifest (`camera-manifest.ts`): add each declared sensor to `supportedFeatures` (e.g. `sensor:bearing`).

---

## Webapp wiring

- `api.ts`: extend `ICamera`/`ICameraWrite`/`ICameraEntry` with `capabilities.sensors` and top-level `geolocation`; add `CAMERA_SENSORS`.
- `onboard.ts`: `ICameraDraft` gains `sensors?: string[]` (in capabilities) and `geolocation?`; thread through `toResourceBody`, `draftFromEntry`, `mergeEdit`, `plainStreamDraft` (sensors default absent), and preserve sensors in `mergeRescan`.
- `lib/camera.ts:capabilityBadges`: add a sensor badge (e.g. "Compass").

## Webapp UI (`CameraWizard.tsx`) — copy is ux-writing-reviewed

- **Entry (`scan` step):** relabel so the two manual routes are legible. Today: "Enter address manually" (→ ONVIF connect) and "Paste a stream URL (rtsp://…)". Reframe the plain-stream entry as **"Set it up manually — enter the camera's stream details"** with a one-line plain explanation.
- **`stream` step:** lead with plain guidance ("You'll need the camera's address and its video-stream link — check the camera's app or manual"); keep the URL paste as a shortcut; present the connection type with human labels (RTSP — most IP/security cameras; RTMP — streaming boxes/some action cams; HTTP — older/simple webcams) rather than bare scheme codes.
- **`details` step (all paths + edit):**
  - Sensor: a checkbox **"This camera reports its own compass bearing"** → toggles `capabilities.sensors` `['bearing']`.
  - Geolocation: an optional group **"Fixed location (shore or fixed-mount cameras)"** with latitude / longitude / elevation / heading, with a note that a boat-mounted camera doesn't need it.

---

## Sequencing (test-first RED→GREEN, adversarial review + gate)

- **Phase 1 — backend model.** `camera-validation.ts` (sensors + geolocation + validators), `camera-merge.ts` (preserve sensors), `camera-manifest.ts` (supportedFeatures). RED: `camera-validation.spec.ts` (accept/normalise/reject each field + bounds; both lat & lon required), `camera-merge.spec.ts` (sensors survive a rescan; geolocation survives), `camera-manifest.spec.ts`.
- **Phase 2 — webapp model wiring.** `api.ts` types, `onboard.ts` (draft threading + mergeRescan + plainStreamDraft), `lib/camera.ts` badge. RED: `onboard.spec.ts`, `camera.spec` badge.
- **Phase 3 — webapp UI.** Manual entry reframe + sensor/geo fields; `CameraWizard.spec.tsx`.
- **Phase 4 — ux-writing review** of all new copy; apply.
- **Phase 5 — full gate** (build, tests, lint, format, theme-contract, webapp build) + adversarial review.

## Verification / invariants to hold

- Aiming unchanged: no edit to `mob-geo.ts` / `fov-calibration.ts` / slew; a grep proves geolocation is read nowhere in aiming.
- Security unchanged: `CAMERA_SCHEMES` allow-list intact; no credential ever in the resource; new fields are plain data, no scheme/host surface.
- Back-compat: every new field optional; existing minimal cameras still validate; sensors/geo absent by default.
