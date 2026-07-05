# Troubleshooting & FAQ

Most problems come down to one of three things: the network blocking discovery, the wrong stream address, or a delivery mode the device doesn't like. Here's how to work through them.

---

## "Scan" finds nothing

- **The network blocked the broadcast.** Discovery uses a network broadcast that some switches, VLANs, guest networks, or a Docker bridge won't pass. This is common and not a fault in your camera. **Fix:** add the camera by hand using its IP address and stream path (from the camera's manual). See [Adding cameras](cameras.md).
- **The camera isn't ONVIF.** Some cheaper or older cameras don't answer discovery. Add it by hand.
- **Different subnet.** The camera and the Signal K server need to be on the same network segment.

---

## The picture won't load

Work down this list:

1. **Check the address and path.** A wrong stream path is the most common cause. Open the camera's own app or manual and confirm the exact path (e.g. `/stream1`, `/h264Preview_01_main`).
2. **Check the login.** If the camera needs a username/password and it's wrong, you'll get no picture. Re-enter it (logins are write-only, so you won't see the old value — just set it again).
3. **Try the other delivery mode.** SK Video walks the transports automatically (WebRTC → HLS → still-refresh); in KIP's Video widget you can also force one under Quality & Latency. Some devices and networks strongly prefer one.
4. **Try the H.264 sub-stream.** If it's an H.265 camera, its picture may not play on your device — point the camera at its H.264 sub-stream instead.

---

## The picture stalls or is choppy

- **Your network is the bottleneck.** The app steps down automatically (WebRTC → HLS → still-refresh) and **climbs back up to WebRTC** once the link recovers, so a brief hiccup shouldn't strand you. If it feels stuck, switch to the camera's lighter **sub-stream**.
- **Too many high-res streams at once.** Each live high-resolution camera costs bandwidth and a little CPU. Use sub-streams for the "glance" views.

> If the live view is showing a **photo every second or two** ("still-refresh, ~1 fps"), it fell back to MJPEG because low-latency WebRTC couldn't connect. The app keeps trying to recover to WebRTC on its own; if it never does, WebRTC's media path is likely blocked on your network — see [The picture won't load](#the-picture-wont-load) and try the sub-stream.

---

## PTZ controls don't move the camera

If tapping the joystick pad or an arrow does nothing, SK Video now tells you the **reason** in a message over the video — read it first:

- **"Can't reach the camera's ONVIF service…"** — pan/tilt/zoom runs over **ONVIF**, which is a separate service (and often a different port) from the video stream. A camera added by its RTSP address may have ONVIF on another port; SK Video probes the common ones automatically, but if ONVIF is turned off on the camera, turn it on in the camera's settings.
- **"The camera rejected the login…"** — the stored login works for video but not for ONVIF control. Re-enter the camera's credentials under **Cameras**.
- **Reached the camera but it's not its ONVIF service** — usually ONVIF is disabled, or the camera exposes it on a non-standard port. Enable ONVIF on the camera.

After changing anything on the camera (enabling ONVIF, a firmware update), use **Re-scan** on the camera's row so SK Video re-detects its controls. On a slow still-refresh feed, continuous panning is disabled on purpose — that's not a fault.

---

## Snapshots come back empty

Some camera types need **ffmpeg** available to the server to produce a snapshot. If your snapshots are empty, install ffmpeg on the Signal K server and try again.

---

## Recording isn't available

Recording is **tier-gated**. A low-power **Cerbo-class** device offers no recording channels by design. Check your tier under the plugin's status, and see [Hardware & performance](hardware-and-performance.md). If you're sure your hardware is capable but it's mis-detected, set the **Hardware tier** override in the SK Video app under **Settings → Operational → Advanced**.

---

## A safety camera alarm keeps firing

If you marked a camera **safety-critical** and it alarms on and off, the camera's feed is genuinely flapping — a weak cable, a marginal PoE budget, or a camera rebooting. The watchdog is debounced to ignore brief blips, so a repeating alarm means a real intermittent fault. Check power and cabling.

---

## FAQ

**Do my camera passwords ever leave the boat?** No. Logins are stored write-only on the server, never read back or sent to your devices, and they're discarded automatically if you repoint a camera at a different address.

**Does it need internet to set up?** Once, briefly, and it handles it for you. When you switch the plugin on it fetches a small streaming helper (go2rtc) in the background — the plugin status shows _“Setting up video…”_ while it does, and there's nothing to allow. If the server is offline right then, it finishes automatically once it's back online. After that everything works offline, and your first camera is ready to stream immediately.

**Can I see the same cameras on every phone and tablet?** Yes — cameras are saved on the boat as shared Signal K resources. Set up once, available everywhere.

**Does it work without KIP?** Yes. SK Video ships its **own** app — open it from the Signal K **Webapps** menu (or `…:3000/sk-video/`), and install it to your home screen if you like. KIP's Video widget is an optional alternative; both share the same cameras. Under the hood it's a standard Signal K plugin with an [HTTP API](../reference/http-api.md), so other apps can use it too.

**How do I open the SK Video app?** From the Signal K admin **Webapps** menu, click **SK Video** — or go straight to `http://<your-server>:3000/sk-video/`. On a phone or tablet, use **Add to Home Screen** to install it.

**The app says alerts are blocked — what now?** Web-push safety alerts need notification permission and, on iPhone, the app installed to your Home Screen first. Allow notifications for the site in your browser settings, then re-open **Settings → Safety alerts**. Delivery is best-effort and needs the boat to have internet.

**Is the man-overboard feature a replacement for proper MOB procedure?** No. It points cameras at a _known position_ to help the lookout; it does not detect or track the person. See [Safety features](safety.md) for an honest account.

**Will recording fill up my disk?** No. Everything that writes to disk is kept to a budget and pruned oldest-first, designed so a full disk can't brick the server.

---

Still stuck? Open an issue on the project's GitHub with your camera make/model, the address/path you used, and which delivery mode you tried — that's usually enough to pin it down.
