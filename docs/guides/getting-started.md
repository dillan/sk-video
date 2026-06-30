# Getting started

This guide takes you from nothing to a live camera on screen. It assumes you already have a **Signal K server** running on your boat (on a Raspberry Pi, a Cerbo GX, a small PC, or similar) and at least one **IP camera** on the same network.

If you're not sure what Signal K is: it's the free open-source software many boats run to collect and share their instrument data (GPS, depth, wind…). SK Video is an add-on for it.

---

## 1. Install the plugin

### The easy way — the Appstore

1. Open your Signal K server's web admin (usually `http://<your-boat-server>:3000`).
2. Go to **Appstore → Available**.
3. Search for **SK Video** and click **Install**.
4. Restart the server if it asks you to.

### From source (until it's listed in the Appstore)

On the server, in a terminal:

```sh
cd ~/.signalk
npm install dillan/sk-video
```

Then restart Signal K.

---

## 2. Switch it on

1. In the Signal K admin, go to **Server → Plugin Config**.
2. Find **SK Video** in the list and switch it **On**.
3. Leave **Hardware tier** on **Auto-detect** — the plugin figures out what your hardware can do.
4. Click **Submit**.

<p align="center">
  <img src="../images/plugin-config.png" alt="Enabling SK Video in the Signal K admin Plugin Config screen" width="85%">
</p>

> **First-run note:** the very first time you add a camera, the plugin downloads a small helper program ([go2rtc](https://github.com/AlexxIT/go2rtc)) once. So the server needs internet access on that first run. After that, everything works offline.

That's all the configuration most boats ever need here. **You don't add cameras on this screen** — you add them from the Video widget (next step), and the plugin remembers them for every device on the boat.

---

## 3. See your first camera

The video itself shows up in **[KIP](https://github.com/mxtommy/Kip)**, the Signal K dashboard app, through its **Video widget**.

1. Open KIP and edit a dashboard.
2. Add a **Video** widget.
3. Open the widget's settings and set **Source** to **Camera**.
4. Click **Scan** to find cameras on the network, pick yours from the list — or **Add a camera** by hand if it doesn't appear (you'll need its address, and a login if the camera requires one).
5. Choose a delivery mode (start with **Standard / HLS**) and **Save**.

<p align="center">
  <img src="../images/camera-setup.png" alt="Adding a camera from KIP's Video widget settings" width="85%">
</p>

You should now have live video:

<p align="center">
  <img src="../images/widget-playing.png" alt="A boat camera playing live in the KIP Video widget" width="85%">
</p>

---

## What just happened?

- Your camera is now saved **on the boat's server** as a Signal K _resource_. Every phone, tablet, and laptop on the boat can use it — you only set it up once.
- The browser is **not** talking to the camera directly. It asks the SK Video plugin, which repackages the camera's stream into something a browser can play. Your **camera login never leaves the server.**

---

## Where to next

- **[Adding & organizing cameras](cameras.md)** — scanning vs. adding by hand, logins, and telling the boat where each camera is mounted (which unlocks the smart features).
- **[Watching video](viewing.md)** — pick the right delivery mode, move a PTZ camera, and use the night/fog picture presets.
- **[Troubleshooting](troubleshooting.md)** — if the scan finds nothing or the picture won't load.
