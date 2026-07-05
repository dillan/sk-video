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
3. Click **Submit**.

That's it — this screen only turns the plugin on and off. There are **no settings to fill in here**: everything you configure (cameras, Frigate, anchor watch, themes, alerts) lives in the **SK Video app**, which you'll open in the next step. The plugin auto-detects what your hardware can do; you can override that later in the app under **Settings → Operational** if it ever guesses wrong.

> **One-time setup, nothing to do:** when you switch the plugin on it quietly fetches a small streaming helper ([go2rtc](https://github.com/AlexxIT/go2rtc)) in the background — the plugin status shows a brief _“Setting up video…”_. There's nothing to allow or configure. If the boat happens to be offline right then, it just finishes setting up automatically the next time it's online. After that, everything works offline — and your first camera streams instantly.

---

## 3. Open the SK Video app

SK Video ships its own console — a web app served by your boat's server, so there's nothing extra to install.

1. In the Signal K admin, open the **Webapps** menu (or go straight to `http://<your-server>:3000/sk-video/`).
2. Click **SK Video**. The app opens to the **Live Wall**.
3. On a phone or tablet, use your browser's **Add to Home Screen** to install it like a native app (it then runs full-screen and can send you safety alerts).

> Prefer KIP? You can also watch cameras in [KIP](https://github.com/mxtommy/Kip)'s **Video widget** — see [Viewing your cameras](viewing.md). Both share the same cameras; set up once, use anywhere.

---

## 4. Add your first camera

In the SK Video app:

1. Go to **Cameras** and choose **Add a camera** (or the onboarding wizard if your wall is empty).
2. Click **Scan** to find cameras on the network and pick yours — or add it by hand if it doesn't appear (you'll need its address, and a login if the camera requires one).
3. Give it a name, set where it's mounted, and **Save**.

Open it from the **Live Wall** and you should have live video. If a camera shows controls but a black picture, see [Troubleshooting](troubleshooting.md) — it's almost always an H.265 main stream, which SK Video works around with the camera's H.264 sub-stream.

---

## What just happened?

- Your camera is now saved **on the boat's server** as a Signal K _resource_. Every phone, tablet, and laptop on the boat can use it — you only set it up once.
- The browser is **not** talking to the camera directly. It asks the SK Video plugin, which repackages the camera's stream into something a browser can play. Your **camera login never leaves the server.**

---

## Where to next

- **[The SK Video app](the-app.md)** — a tour of the console: Live, Library (recordings, incidents, events, snapshots), Safety, and Settings.
- **[Adding & organizing cameras](cameras.md)** — scanning vs. adding by hand, logins, and telling the boat where each camera is mounted (which unlocks the smart features).
- **[Watching video](viewing.md)** — pick the right delivery mode, move a PTZ camera, and use the night/fog picture presets.
- **[Troubleshooting](troubleshooting.md)** — if the scan finds nothing or the picture won't load.
