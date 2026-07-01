# Advanced features

Beyond plain viewing, SK Video has a handful of bigger tools. Most are optional and a few need extra hardware or software. Each comes with an honest note on its limits.

---

## AIS "point at that ship"

If you have a calibrated pan/tilt camera with absolute positioning, you can tell it to **slew to the nearest collision-risk vessel** — the AIS target with the smallest closest-point-of-approach (CPA). The camera swings to where that ship is and frames it.

- It's a **single, deterministic aim** — point me at it _now_ — not continuous tracking. Ask again to re-cue as the situation changes.
- It uses the same geo-pointing engine as man-overboard: the boat's position and heading, the target's AIS position, and the camera's calibration.
- It needs a **calibrated** absolute-PTZ camera; an uncalibrated or fixed camera can't be aimed.
- It assumes the AIS data is current — a stale contact may be a vessel that's no longer there.

**Calibrating a camera (one time).** Geo-pointing — both slew-to-cue and man-overboard — needs to know how the camera's pan/tilt numbers map to real-world bearings. You teach it that once with the **calibration wizard** in the SK Video app (open a camera in Camera Focus): aim the camera at two known directions for each axis and save. SK Video works out the mapping and stores it on the camera, so you never type any numbers. Re-run it any time if the camera is remounted.

Great for "what's that ship crossing our bow?" without leaving the helm.

---

## Two-way audio

Cameras that have a built-in speaker (an ONVIF audio output) can be used to **hail** — talk to someone on the foredeck or at the dock. In Camera Focus it's a **Two-way audio** toggle: open the channel to talk through the camera's speaker, then tap again to close it and release your mic. (A separate **Listen** toggle un-mutes the camera's own microphone so you can hear it.) SK Video routes this through the same same-origin path as the video.

Honest limits:

- It uses the camera's **native** two-way audio, and it's **camera- and codec-dependent** — not every camera supports it, and audio quality varies.
- It's **best-effort hailing/intercom**, not telephony-grade.
- It's offered only when the camera reports a speaker — in the SK Video app's Camera Focus, or in the KIP widget.

---

## 360° cameras

A masthead 360° camera can replace several fixed cameras — one device, a full-circle view, and no pan/tilt motor to seize up in salt air. SK Video supports the common 360 projections (equirectangular, fisheye, dual-fisheye) by flagging the camera's projection type so the **viewing app** can render a smooth "virtual PTZ" you swipe around.

- The **server passes the stream through unchanged** — it never tries to flatten ("dewarp") a 360 image, because doing that on a small server would peg a CPU core. The dewarping happens in your browser.
- 360 streams are bandwidth-heavy; pair them with a camera **sub-stream** on weaker networks.

**Action cameras (GoPro / Insta360)** can be onboarded opportunistically — there are built-in hints for them — but treat them as _temporary_ sources, not permanent installs: their live-streaming modes are lower-resolution, need external power, and reconnect unreliably.

---

## Frigate motion alerts

If you run **[Frigate](https://frigate.video/)** (a popular open-source camera AI) on your own hardware, SK Video can consume its detections and surface **person / car / boat** alerts as Signal K notifications — with a short clip of the event cached on the boat for review.

To connect it, open the SK Video app and go to **Settings → Operational → Frigate**: enter the broker **host / port** (and a **username / password** if your broker needs one — the password is write-only and never shown back), and optionally the **HTTP API URL** for clips. You can filter by **labels**, a **minimum confidence score**, and specific **zones**. Saving briefly restarts the plugin to connect.

Honest limits — these matter:

- **Frigate is never bundled.** It runs on _your_ hardware (it wants real compute — think a Pi 5 with a Coral accelerator, or a small PC). SK Video only _listens_ to it.
- It's **close-range, COCO-class** detection — good for "someone's on the foredeck" or "a boat entered the marina". It is **not** a hazard, deadhead-log, or man-overboard-at-distance detector, and must never be used as one.
- Clip caching is **best-effort** and only happens if you also give it the HTTP API URL.

Frigate is also what powers the **experimental visual MOB refine** (see [Safety features](safety.md#experimental-visual-refine-off-by-default)).

---

## Incident bundles

For an event worth keeping, SK Video can assemble a single **incident bundle**: a short **before-and-after clip** from each camera, a **sampled track** of the boat's telemetry across the event, and **snapshots** — all packaged together with the position and time.

- The reliable trigger is the **manual "mark incident"** button — in the SK Video app's **Review → Recordings**, where you can also scrub the DVR timeline back and **mark an incident from a past moment**. You can also set an **incident auto-trigger path** in **Settings → Operational** (e.g. an alarm subtree) so a bundle is captured automatically when that alarm fires.
- A bundle is **honest about completeness**: if a clip couldn't be captured but the telemetry and snapshots were, it's marked _partial_ with the failures recorded — never silently claimed complete.
- Browse and review bundles in **Review → Incidents**; **pin** one so retention never prunes it, add a label or notes, and **export a `.zip`** to share what was captured (manifest + clips + telemetry + an honesty README).

> Pre-roll (the "before") means the plugin is always keeping a short rolling buffer — a small continuous cost, even when you're not actively recording. It's best-effort evidence, not a legal black box.

---

## Where to next

- **[The SK Video app](the-app.md)** — the console where you drive all of this (Live, Review, Safety, Settings).
- **[Hardware & performance](hardware-and-performance.md)** — which of these your hardware can sustain.
- **[What it is — and isn't](../reference/capabilities.md)** — the full honesty ledger.
- **[Settings & configuration](../reference/configuration.md)** — every operational setting these features use.
