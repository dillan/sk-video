# Safety features

SK Video can turn your cameras into safety instruments: point every capable camera at a man-overboard position, capture evidence the moment your anchor alarm fires, and warn you when a camera you rely on goes dark.

> **Read this first.** These features **support** good seamanship — they don't replace it. The plugin is honest about what it can and can't do, and this guide is too. Nothing here is a certified safety device. Always follow standard procedure.

---

## Man-overboard (MOB) camera pointing

When you trigger a man-overboard event (from a button in KIP, or a key mapped to it on the boat), SK Video does several things at once:

1. **Drops a marker** at the person's last known position (`navigation.mob.position`) — the same kind of marker a chartplotter's MOB button creates.
2. **Raises an emergency notification** on the boat's network so every screen and alarm hears it.
3. **Takes a snapshot** and **starts recording** on every camera.
4. **Points every capable pan/tilt camera** at the man-overboard position — and keeps re-pointing them as the boat drifts, so the cameras stay aimed at the spot in the water even while the boat moves.

### How the pointing actually works (and its honest limits)

This is **geo-pointing to a known position — not visual tracking.** The cameras are aimed using geometry: the boat's position and heading, the target's position, and each camera's mounting and calibration. It does **not** try to _see_ the person in the water.

The target is chosen, best source first:

| Priority | Target | When |
| --- | --- | --- |
| 1 | **A live AIS man-overboard beacon** (a personal AIS-MOB / AIS-SART device) | If the casualty is wearing one, its own GPS reports where they are — and the cameras follow _them_ as they drift, not a stale spot. |
| 2 | **The dead-reckoned datum** | No beacon: the position captured the instant the alarm fired, carried forward by the boat's motion. |
| 3 | **Manual** | Last resort. |

What it **can't** do, stated plainly:

- It points at a **position**, not a person. Normalized camera pointing is approximate — think "bring the area into frame", not "crosshair on the swimmer".
- A camera with no pan/tilt, or one that isn't calibrated, will still **record and mark** — it just can't be aimed.
- If there's **no GPS fix**, the notification tells you so honestly — it will say the cameras could not be aimed, rather than pretending they're pointed somewhere.
- The on-screen count of "cameras aimed" reflects cameras actually commanded toward the target (and excludes ones stuck at their mechanical limit). It's best-effort, not a guarantee the motor obeyed.

**Bottom line:** MOB pointing is a force-multiplier for the lookout — it gets cameras looking at the right patch of water automatically — but the lookout, the GPS/DSC MOB button, the throwable, and the crew are the safety system. SK Video assists them.

### Experimental: visual refine (off by default)

There's an optional, clearly-labelled **"Experimental visual MOB refine (NOT safety-rated)"** setting. When it's on _and_ you run a [Frigate](advanced.md#frigate-motion-alerts) person-detector, a confident detection can add a **small, bounded nudge** on top of the geo-pointing — a little correction toward a detected person, layered over the authoritative position-based aim.

It is deliberately conservative:

- **Off by default.** You must turn it on.
- **Geo-pointing stays in charge.** The nudge never replaces position-based aim; the baseline re-asserts continuously, so a bad nudge is bounded and self-correcting.
- **It fails safe.** If detections stop or get unreliable, it raises a notice — _"Visual tracking lost — reverting to position-based aim"_ — and steps back to pure geo-pointing.
- **It's honest about being weak.** It can't hold a tiny, low-contrast person on open water and it can lock onto a wake or whitecap. That's exactly why it's an off-by-default assist, not a safety claim.

If you don't run Frigate, this setting does nothing.

---

## Anchor-watch evidence

If you already get an **anchor-drag or geofence alarm** — from Signal K's Anchor API or another plugin — SK Video can react to it automatically. The moment that alarm fires, it:

- captures a snapshot and a short recording on your **anchor / security**-role cameras, and
- raises **one** consolidated notification linking the evidence.

Important: SK Video **does not compute anchor drag itself.** It _consumes_ the alarm you already produce and turns it into local evidence on the right cameras. It's "automatic evidence when the alarm sounds", not a monitoring service.

To use it, set the **Anchor/geofence watch path** in the plugin config (it defaults to `notifications.navigation.anchor`) and tag the relevant cameras with the **anchor** or **security** role (see [Adding cameras](cameras.md)). Leave the path blank to turn it off.

---

## Camera watchdog

Mark a camera as **safety-critical** and SK Video keeps an eye on it. If that camera goes dark — loses its feed — you get an alarm on the boat's network, and a clear notice when it comes back.

- It's **debounced**, so a brief network blip won't cry wolf: a camera has to stay dark for around three-quarters of a minute before the alarm fires, and recover for about half a minute before it clears.
- It's **opt-in per camera** — only cameras you mark as safety-critical are watched.

This is honest situational awareness ("the engine-room camera you depend on just stopped"), not a guarantee of uptime — a power or cable failure still loses the camera; the watchdog just makes sure you _know_.

---

## A note on honesty

Throughout these features, SK Video tries hard not to over-promise:

- MOB is **geo-pointing**, not person-tracking.
- Visual refine is **experimental and off by default**.
- Anchor-watch **consumes** your alarm; it doesn't compute drag.
- Snapshots and recordings are **best-effort evidence**, not a certified recorder.

For the complete list of what the system is and isn't, see [What it is — and isn't](../reference/capabilities.md).
