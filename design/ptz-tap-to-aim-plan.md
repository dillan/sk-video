# Tap-to-aim for PTZ cameras

_Single tap on the live video aims the camera at that point. Synthesised from a source-verified map of the PTZ dispatch, FOV/calibration, MOB-aim, gesture, capability, and prefs subsystems (July 2026)._

---

## Decision: single tap, not double tap

Every major PTZ/VMS system uses a **single click/tap to center on that point** (Milestone XProtect's default "click-to-center" mode; Axis center-on-click; Hikvision/Dahua "3D positioning"), with drag-a-box to zoom as the companion gesture. **Double-tap is not used for aiming anywhere** — and on touch it already means _zoom_ (maps, photos, video), so using it to aim would fight the operator's reflex.

The spurious-tap worry (gloves, boat motion, a busy helm) is real but is better solved by design than by a double-tap gate: the aim is a **bounded, recoverable move** (it can't run away), it's **scoped to the deliberate single-camera Focus view**, and it **discriminates tap from drag**. Those address stray taps more effectively than a double-tap would, while staying conventional.

---

## Load-bearing finding: a tap is an image offset, not a world bearing

The obvious approach — "convert the tap to a compass bearing and reuse the MOB geo-aim" — is **wrong** for a tap:

- `computeAim()` (`src/safety/mob-geo.ts:84`) maps a **world bearing → normalized pan** using per-camera `calibration`. That's for pointing at a GPS/AIS target; a tap has no bearing.
- The only "FOV" the code stores is the **mechanical pan/tilt range** (`2/scalePerDeg` from `src/onvif/fov-calibration.ts`), _not_ the lens angle-of-view. Converting a tapped pixel to an exact angle needs the lens angle-of-view, which is **unmodeled and zoom-dependent**.

The right primitive already exists: `visualCorrection()` (`src/safety/mob-visual-refine.ts:60`) turns an **image-centre offset (0..1) → a bounded pan/tilt nudge** (`pan: dx*gain, tilt: -dy*gain`, clamped). That is exactly tap-to-aim.

**So tap-to-aim uses a proportional/relative move toward the tapped point, not a bearing computation.** Consequences: it works on **any** PTZ camera (no calibration required), it is **recoverable by construction** (a bounded move), and it **converges** the tapped point toward centre over 1–2 taps. Exact one-tap centring is future work (needs a lens angle-of-view; see Out of scope).

---

## Behaviour (the UX contract)

- **Single tap** on the live video in the **single-camera Focus view** aims the camera so the tapped point moves toward centre.
- **Enabled only when**: camera is PTZ (`capabilities.ptz`), the feed is **live** (not the ~1 fps MJPEG rung — `ptzDelayed(rung) === false`), the user has **write access**, and the per-device **"tap to aim" pref** is on (default **on**). Independent of the `continuousPtz` pref — tap-to-aim is discrete and safer, so it's available even when continuous drag is off.
- **Tap ≠ drag**: only a short, stationary press-release counts (Δt < ~250 ms and movement < ~10 px). Drag stays "continuous pan" (unchanged, still behind the `continuousPtz` opt-in). Pinch/wheel-zoom unchanged.
- **Feedback**: a brief red crosshair/ripple at the tap point + the existing action-message chip for the outcome (`aimed` / `at limit` / `not supported`). STOP stays present and authoritative.
- **Not on the Live Wall grid** — there a tap opens a camera. Deliberately excluded.

---

## The aim math

- Tap → normalised position in the video element, offset from centre: `dx = x − 0.5`, `dy = y − 0.5`, each in `[−0.5, 0.5]` (`+dx` = right, `+dy` = down in image space).
- The player uses `object-fit: cover` (`webapp/src/theme.css:1237`), so the video **fills** the container (crop, not letterbox) and the gesture overlay's own `getBoundingClientRect()` gives the offset directly — **no letterbox math needed**.
- The **backend** turns `{dx, dy}` into the best available move per the camera's detected capabilities (it already owns the primitives + capability detection in `OnvifPtzController`):
  - **absolutePtz** (`src/onvif/onvif-controller.ts:185`): read current position (`getStatus`), `moveAbsolute({pan: clamp(cur.pan + gain·dx), tilt: clamp(cur.tilt − gain·dy)})`. Precise, self-completing.
  - **relative-move supported** (`onvif-controller.ts:196`): `moveRelative({pan: gain·dx, tilt: −gain·dy})`.
  - **continuous-only** (baseline `ptz`): a bounded continuous nudge then `stop` — the pattern the chevron "step" already uses (`webapp/src/components/CameraControls.tsx:191`).
  - `gain`/`maxStep` clamp reused from the `visualCorrection` pattern; tuned so one tap moves ~most of the way, converging in 1–2 taps without overshoot.

---

## Architecture

### Backend

- **New pure module** `src/onvif/ptz-aim.ts` — `planAim(caps, currentPosition, {dx,dy}, opts) → { kind: 'absolute'|'relative'|'continuous', command, outcome }`. `outcome ∈ 'aimed' | 'at-limit' (clamped) | 'unsupported'`. No ONVIF, no I/O — fully unit-testable.
- **New route** `POST /cameras/:id/ptz/aim` body `{dx, dy}` in `src/onvif/ptz-routes.ts`, alongside `/ptz`, `/ptz/stop`. Same `hasPtz` → 501 gate (`ptz-routes.ts:50`) and write-auth path. Handler: `controllerFor(id)` → read position when the plan needs it → dispatch the planned command → map ONVIF failures through `src/onvif/onvif-errors.ts` (→ 502 + reason). Returns `{ outcome, aim }` or 204.
- Reuse the shared `TAimOutcome` vocabulary (`src/safety/mob-controller.ts:52`, `webapp/src/api.ts:135`).

### Frontend

- **`webapp/src/lib/usePtzGestures.ts`**: add tap detection in the existing `down`/`up` handlers — record the down timestamp + point; on up, if `Δt < ~250 ms` and move `< ~10 px`, fire a new `onTap(nx, ny)` (normalised to the overlay rect) instead of the drag path. Drag/pinch/wheel unchanged.
- **`webapp/src/screens/CameraFocus.tsx`**: wire `onTap` → compute `{dx,dy}` → `ptzAim(cameraId, dx, dy)` → drop a crosshair at the tap point, `bumpPtzActive()`, show the outcome chip (`.focus__msg`). Enable the tap path with the same gate as the pad — `ptz && !ptzDelayed(rung) && !gate.disabled` — plus the new `tapToAim` pref.
- **API client** (`webapp/src/api.ts`, next to `ptzNudge` at :404): `ptzAim(id, dx, dy) → POST /cameras/:id/ptz/aim`.
- **Overlay** — a new `.tap-aim__mark` crosshair modelled on `.mob__reticle` (`webapp/src/theme.css:1484`): red (`--status-live`), `.class__el`/`.class--mod` conventions, **no blue/green/white, no box-shadow glow in Night-Red** (the `theme-contract.spec` rules); fades out ~1 s.
- **Pref** — `loadTapToAim`/`saveTapToAim` (default **true**) in `webapp/src/lib/ptz-prefs.ts` + a toggle in `webapp/src/screens/Settings.tsx` next to "Continuous PTZ".

---

## Safety / edge cases (marine helm)

- **Recoverable by construction** — every path is a bounded move (`maxStep` clamp / absolute-with-clamp); a stray tap nudges slightly, never runs away. Matches the existing "a one-shot move can't run away from you" principle.
- **Not on the 1 fps rung** — gated off when `ptzDelayed(rung)` (you can't see where you're aiming on a still-refresh).
- **Read-only** — same `useWriteGate` disable as the rest of the controls.
- **Unsupported / offline** — 501 (no PTZ) and 502 (ONVIF/network, redacted) reuse existing handling; the chip says so plainly.
- **at-limit** — when the clamp fires, report it (camera pointed as far as it can), same wording as MOB.

---

## Tests (test-first, RED → GREEN)

- **Backend unit** (`ptz-aim.spec.ts`): `planAim` picks absolute vs relative vs continuous per capability; clamps to `at-limit`; sign conventions (`+dy` tilts _down_); `unsupported` with no PTZ. Route spec: 501 no-PTZ, 502 ONVIF error, happy path dispatches the planned command with the right args.
- **Frontend unit**: tap-vs-drag threshold in `usePtzGestures`; `{dx,dy}` from a tap over a mocked rect; gating (off when delayed / read-only / pref off); `ptzAim` client hits the right endpoint/body; the crosshair renders and clears.
- **Theme**: `theme-contract.spec` stays green with the new `.tap-aim__*` rules (no cool colours / no night glow).
- **e2e** (later, non-blocking given the go2rtc CI flake tracked in #93): a tap dispatches an aim to the ONVIF virtual device.

---

## Sequencing

1. **Backend** `planAim` pure module + `POST /ptz/aim` route (RED → GREEN).
2. **API client** `ptzAim`.
3. **Gestures + wiring** — `usePtzGestures` tap detection + `CameraFocus` wiring + gating.
4. **Overlay + pref** — `.tap-aim__mark` crosshair + Settings toggle.
5. **Adversarial review** + full local gate (typecheck, lint, tests, build).

---

## Out of scope / future

- **Exact one-tap centring** — needs a per-camera lens angle-of-view (zoom-aware); a real enhancement but requires a new calibration capture or a lens-FOV field. Not blocking the proportional-converge MVP.
- **Drag-a-box to zoom** (the "3D positioning" companion) — natural follow-up that reuses this tap plumbing.
- Tap-to-aim on the **Live Wall grid**.
