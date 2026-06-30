# SK Video documentation

Watch your boat's cameras — and turn them into safety instruments — right in your Signal K dashboard. These pages cover everything from a first install to the internals.

> New here? Start with the [Boater's guide](#for-boaters). Want to contribute or understand how it works under the hood? Jump to the [Developer guide](#for-developers).

---

## For boaters

Plain-language, step-by-step guides. No coding required.

| Guide | What it covers |
| --- | --- |
| **[Getting started](guides/getting-started.md)** | Install the plugin, switch it on, and see your first camera. |
| **[Adding & organizing cameras](guides/cameras.md)** | Scan the network or add a camera by hand, give it a login, and tell the boat where it's mounted. |
| **[Watching video](guides/viewing.md)** | Delivery modes (smooth vs. low-latency), moving a PTZ camera, and night/fog/glare picture presets. |
| **[Snapshots & recording](guides/snapshots-and-recording.md)** | Save a photo with your GPS position baked in, and record a camera to the boat. |
| **[Safety features](guides/safety.md)** | Man-overboard camera pointing, anchor-watch evidence, and the camera watchdog — with an honest account of what they can and can't do. |
| **[Advanced features](guides/advanced.md)** | AIS "point at that ship", two-way audio, 360° cameras, Frigate motion alerts, and incident clips. |
| **[Hardware & performance](guides/hardware-and-performance.md)** | What runs well on a Cerbo, a Raspberry Pi, or a small PC — and how to get the best picture. |
| **[Troubleshooting & FAQ](guides/troubleshooting.md)** | Fixes for the most common "it won't load" problems. |

## Reference

Look-it-up tables for when you need an exact value.

| Reference | What's in it |
| --- | --- |
| **[Plugin configuration](reference/configuration.md)** | Every setting on the plugin's config page. |
| **[Camera model](reference/camera-model.md)** | Every field a camera can have (mount, role, capabilities, calibration…). |
| **[HTTP API](reference/http-api.md)** | Every endpoint the plugin exposes, grouped by feature. |
| **[What it is — and isn't](reference/capabilities.md)** | An honest capability ledger: the promises we keep and the ones we deliberately don't make. |

## For developers

Approachable technical docs with diagrams. New contributors welcome — these explain _how_ and _why_, not just _what_.

| Doc | What it covers |
| --- | --- |
| **[Architecture overview](developers/architecture.md)** | The big picture: processes, data flows, and the component map. |
| **[Streaming pipeline](developers/streaming-pipeline.md)** | How an `rtsp://` camera becomes browser-playable video, step by step. |
| **[Safety & awareness flows](developers/safety-and-awareness.md)** | Man-overboard, anchor-watch, and AIS slew-to-cue, as sequence and flow diagrams. |
| **[Discovery & onboarding](developers/discovery-and-onboarding.md)** | How "scan" finds cameras and fills in the form with no typing. |
| **[Security model](developers/security-model.md)** | The invariants every change must keep, with the SSRF/same-origin decision flow. |
| **[Storage & data lifecycle](developers/storage-and-data.md)** | Resources, stores, quotas, and how a full disk can never brick the server. |
| **[Regenerating screenshots](developers/screenshots.md)** | The reproducible Playwright pipeline that keeps these docs' screenshots current. |

Also useful: [`CONTRIBUTING.md`](../CONTRIBUTING.md) (setup + checks), [`AGENTS.md`](../AGENTS.md) (a terse codebase map), and the [`e2e/` harness](../e2e/README.md) (a throwaway Docker stack with a simulated camera).

---

## What is SK Video, in one paragraph?

SK Video is a [Signal K](https://signalk.org/) **server plugin**. Browsers can't open the `rtsp://` streams most IP cameras produce, can't speak the **ONVIF** language cameras use for pan/tilt/zoom, and can't find cameras on the network. SK Video does all of that **on the boat's server** and hands the browser a picture it can show — same-origin, with your camera logins never leaving the boat. On top of plain viewing it adds marine-specific instruments: point every camera at a man-overboard position, capture position-stamped snapshots and incident clips, record to the boat, and react to your own anchor and AIS alarms. The viewing UI lives in the separate [KIP](https://github.com/mxtommy/Kip) app's Video widget; this plugin is the engine behind it.
