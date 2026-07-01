# What it is — and isn't

SK Video tries hard not to over-promise. This page is the honest ledger: what each feature really does, and the lines we deliberately don't cross. If you only read one reference page, read this one — it'll save you from trusting a feature beyond its design.

---

## Man-overboard (MOB)

- **Is:** geo-pointing to a _known position_ — a live AIS-MOB beacon's GPS, or a dead-reckoned datum from the moment the alarm fired. It marks the position, alarms, snapshots, records, and aims every capable PTZ camera at the spot, re-aiming as the boat drifts.
- **Isn't:** visual person-tracking. It never depends on _seeing_ the person. Pointing is approximate ("bring the area into frame"). With no GPS fix it says so honestly and aims nothing. It **supports, never replaces** standard MOB procedure (lookout, GPS/DSC MOB button, throwable).

## Visual MOB refine (experimental)

- **Is:** an off-by-default, bounded nudge that a Frigate person-detection can add _on top of_ geo-pointing, which stays authoritative and re-asserts continuously. Fails safe — reverts to position-based aim and notifies on track loss.
- **Isn't:** safety-rated, or reliable. It can't hold a tiny, low-contrast person on open water and can lock onto a wake or whitecap. It does nothing without a user-run Frigate. That's why it's an off-by-default assist with **no safety claim**.

## Anchor-watch automation

- **Is:** automatic evidence — when _your_ anchor-drag/geofence alarm fires, it snapshots and records the anchor/security cameras and raises one consolidated alert.
- **Isn't:** a drag detector or a monitored service. It **consumes** an alarm you already produce; it doesn't compute drag itself.

## Camera watchdog

- **Is:** a debounced "this safety-critical camera went dark" alarm (and a clear when it returns), opt-in per camera.
- **Isn't:** an uptime guarantee. A power or cable failure still loses the camera; the watchdog makes sure you _know_.

## Frigate analytics

- **Is:** consumption of a **user-run** Frigate's person/car/boat detections as notifications + cached clips. Close-range, COCO-class object detection.
- **Isn't:** bundled (Frigate runs on your own hardware), and **must never** be used as a hazard, deadhead-log, debris, or man-overboard-at-distance detector. It isn't one.

## Snapshots & recording

- **Is:** best-effort onboard capture. Snapshots can carry an honest position stamp (or a clear "no fix"); recording is a tier-gated rolling buffer, pruned so a full disk can't brick the server.
- **Isn't:** a certified VDR / black box / chain-of-custody recorder. Best-effort evidence, not a legal record. Burn-in only ever touches a saved photo, never the live stream.

## Incident bundles

- **Is:** a packaged clip + telemetry track + snapshots around an event, honest about completeness (marked _partial_ with the failures recorded if a piece couldn't be captured).
- **Isn't:** guaranteed-precise or free — pre-roll means always buffering a little. The manual "mark incident" trigger is the reliable path; auto-triggers from alarms are best-effort.

## DVR scrubber & retrospective incidents

- **Is:** a scrub of the rolling recording buffer, and a "mark incident from a past moment" that cuts a bundle from whatever DVR segments still exist around that instant (`triggerAt`). Coverage is clamped honestly — the manifest records what was asked for vs. what the segments actually held.
- **Isn't:** a way to recover footage that was never recorded or has already been pruned. The retrospective cut reaches back only as far as the buffer does, and the clip can jump across a recorder-restart gap (disclosed as non-contiguous).

## Incident export.zip

- **Is:** a shareable zip — manifest, an honesty README, and every captured asset — so you can hand off "what was captured." The per-file sha256 lets a recipient confirm the bytes weren't altered, and partial coverage is disclosed in the README.
- **Isn't:** chain-of-custody. The sha256 is a file-integrity check, not a custody guarantee, and a partial bundle stays partial — the zip shares what was captured, nothing more.

## Event log / activity feed

- **Is:** a durable, best-effort record of safety/system events (MOB armed, incident captured, anchor drag, camera offline), so "reconstruct what happened last night" is possible after the live notifications have cleared.
- **Isn't:** a certified VDR. It carries only type/state/message (no secrets), is best-effort, and prunes the oldest rows past a cap (~5000) — old enough history eventually rolls off.

## Web-push safety alerts

- **Is:** best-effort, outbound-only push of alerting events to subscribed devices, so a phone can wake even with the app closed. The Pi only ever makes outbound requests — it never needs to be internet-reachable — and payloads are end-to-end encrypted.
- **Isn't:** guaranteed delivery. It needs the boat to have connectivity to send, a non-alerting/clear state doesn't push, and on iOS it only works from the installed PWA.

## AIS slew-to-cue

- **Is:** a single deterministic aim of a calibrated PTZ camera at the nearest collision-risk (smallest CPA) AIS target.
- **Isn't:** tracking (re-POST to re-cue), and not the MOB feature — though it shares the same geo math. A stale AIS contact may no longer be there.

## Adaptive transport

- **Is:** a server-published recommendation (codec-aware `webrtc → hls → mjpeg`) that the app's player walks down on a starved link **and climbs back up** to WebRTC when the network recovers — so a transient hiccup doesn't strand you on the still-refresh floor. The player keeps the last frame on screen during a switch, and refreshes the still-image floor faster (≈4 fps) while you're actively driving PTZ, so a move is visible right away. MJPEG mode is a **still-refresh loop**, a photo every second or two.
- **Isn't:** a true adaptive-bitrate (ABR) ladder, and not continuous video at the bottom rung. Browser H.265 support is uneven; H.264 is the most reliable everywhere.

## 360° & action cameras

- **Is:** projection-flagged ingest (equirectangular / fisheye / dual-fisheye) so the **browser** renders a virtual pan/tilt/zoom view you swipe around.
- **Isn't:** server-side dewarp (that would peg a CPU core on a Pi — it's always client-side). Action cams (GoPro/Insta360) are **opportunistic, not permanent installs**: reverse-engineered preview modes, lower resolution, external power, unreliable reconnects.

## Two-way audio

- **Is:** the camera's **native** two-way audio backchannel (where it has a speaker), routed same-origin. In Camera Focus it's a toggle — open the channel to hail, close it to release the mic. There's also a **Listen** toggle that un-mutes the camera's own audio.
- **Isn't:** telephony-grade, and not WHIP ingest. Camera- and codec-dependent; quality varies.

## Spotlight & alarm

- **Is:** control of a camera's white-light **spotlight** and audible **alarm/siren** — _only_ when the camera advertises the matching ONVIF auxiliary command. Both surface as toggles in Camera Focus; sounding the alarm takes a confirm.
- **Isn't:** universal. ONVIF has **no standard** spotlight/siren command, so this rides freeform auxiliary commands that many cameras (including some that drive these fixtures through a proprietary API) don't expose over ONVIF — so the controls simply won't appear there. State is optimistic (ONVIF gives no reliable read-back). Detection + control are implemented to the ONVIF spec and unit-tested, but were **not yet verified on real aux-capable hardware**.

## Installable PWA & offline bounds

- **Is:** an installable app whose shell (HTML/JS/CSS/icon) works offline once you've visited it, and already-viewed evidence stays reachable. Navigations are network-first, falling back to the cached shell only when offline.
- **Isn't:** an offline mirror of the boat. Live video and every fresh list always require connectivity — stale safety/operational data must never be served from cache — so the offline part is bounded to the shell plus evidence you'd already loaded.

---

## Things we deliberately do **not** offer

These were considered and ruled out on purpose:

- **Floating-hazard / deadhead / debris detection** — no off-the-shelf model holds up on water.
- **MOB _visual_ tracking as a safety feature** — geo-pointing is the safety floor; vision is an off-by-default assist only.
- **Server-side 360 dewarp** — client-side WebGL only.
- **Certified VDR / black-box / chain-of-custody** — captures are best-effort evidence.
- **Autonomous docking / steering / control-law integration** — entirely out of scope.
- **ONVIF PullPoint camera events** — not production-ready in the pinned `onvif@0.8.1`, so the plugin does not consume them. Camera-side event alerting flows through [Frigate](../guides/advanced.md#frigate-motion-alerts) (or a camera's own MQTT) instead.

If a third-party page or comparison claims SK Video does one of the above, it's wrong — by design.
