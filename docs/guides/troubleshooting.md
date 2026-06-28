# Troubleshooting & FAQ

Most problems come down to one of three things: the network blocking discovery, the wrong stream
address, or a delivery mode the device doesn't like. Here's how to work through them.

---

## "Scan" finds nothing

- **The network blocked the broadcast.** Discovery uses a network broadcast that some switches, VLANs,
  guest networks, or a Docker bridge won't pass. This is common and not a fault in your camera.
  **Fix:** add the camera by hand using its IP address and stream path (from the camera's manual). See
  [Adding cameras](cameras.md).
- **The camera isn't ONVIF.** Some cheaper or older cameras don't answer discovery. Add it by hand.
- **Different subnet.** The camera and the Signal K server need to be on the same network segment.

---

## The picture won't load

Work down this list:

1. **Check the address and path.** A wrong stream path is the most common cause. Open the camera's own
   app or manual and confirm the exact path (e.g. `/stream1`, `/h264Preview_01_main`).
2. **Check the login.** If the camera needs a username/password and it's wrong, you'll get no picture.
   Re-enter it (logins are write-only, so you won't see the old value — just set it again).
3. **Try the other delivery mode.** Switch between **Standard (HLS)** and **Low latency (WebRTC)** in
   the widget's Quality & Latency settings. Some devices and networks strongly prefer one.
4. **Try the H.264 sub-stream.** If it's an H.265 camera, its picture may not play on your device —
   point the camera at its H.264 sub-stream instead.

---

## The picture stalls or is choppy

- **Your network is the bottleneck.** Step down: WebRTC → HLS → still-refresh, or switch to the
  camera's lighter **sub-stream**.
- **Too many high-res streams at once.** Each live high-resolution camera costs bandwidth and a little
  CPU. Use sub-streams for the "glance" views.

---

## Snapshots come back empty

Some camera types need **ffmpeg** available to the server to produce a snapshot. If your snapshots are
empty, install ffmpeg on the Signal K server and try again.

---

## Recording isn't available

Recording is **tier-gated**. A low-power **Cerbo-class** device offers no recording channels by design.
Check your tier under the plugin's status, and see [Hardware & performance](hardware-and-performance.md).
If you're sure your hardware is capable but it's mis-detected, set the **Hardware tier** override in the
plugin config.

---

## A safety camera alarm keeps firing

If you marked a camera **safety-critical** and it alarms on and off, the camera's feed is genuinely
flapping — a weak cable, a marginal PoE budget, or a camera rebooting. The watchdog is debounced to
ignore brief blips, so a repeating alarm means a real intermittent fault. Check power and cabling.

---

## FAQ

**Do my camera passwords ever leave the boat?**
No. Logins are stored write-only on the server, never read back or sent to your devices, and they're
discarded automatically if you repoint a camera at a different address.

**Why does the first camera take a moment / need internet?**
The first time you add a camera, the plugin downloads a small helper program (go2rtc) once. After that
it works offline.

**Can I see the same cameras on every phone and tablet?**
Yes — cameras are saved on the boat as shared Signal K resources. Set up once, available everywhere.

**Does it work without KIP?**
The viewing UI is KIP's Video widget, so that's the easy path. Under the hood the plugin is a standard
Signal K plugin with an [HTTP API](../reference/http-api.md), so other Signal K apps can use it too.

**Is the man-overboard feature a replacement for proper MOB procedure?**
No. It points cameras at a _known position_ to help the lookout; it does not detect or track the person.
See [Safety features](safety.md) for an honest account.

**Will recording fill up my disk?**
No. Everything that writes to disk is kept to a budget and pruned oldest-first, designed so a full disk
can't brick the server.

---

Still stuck? Open an issue on the project's GitHub with your camera make/model, the address/path you
used, and which delivery mode you tried — that's usually enough to pin it down.
