# Hardware & performance

SK Video runs on the same little computer as your Signal K server. Plain viewing and camera control work on **everything**. The heavier features — recording, hardware-accelerated snapshots, on-device AI — scale with the hardware. SK Video detects what you have and only offers what it can actually sustain.

---

## Hardware tiers

On startup the plugin sizes up your hardware (CPU cores, memory, architecture, and any AI accelerator) and picks a **tier**. You can override it in the plugin config if the auto-detection is wrong, but **Auto-detect** is right for almost everyone.

| Tier | Typical hardware | Recording | Fast snapshots | On-device AI | Cameras you can record at once |
| --- | --- | --- | --- | --- | --- |
| **Minimal** | Cerbo GX, Pi Zero/2 | — | — | — | 0 |
| **Pi 4** | Raspberry Pi 4 | ✅ | — | — | 2 |
| **Accelerated** | Pi 4/5 + Coral, Hailo, or an NPU board | ✅ | ✅\* | ✅ | 3 |
| **x86** | Intel NUC, small PC | ✅ | ✅\* | ✅ | 6 |

\* Hardware-accelerated snapshots also need a working graphics/render device on the server; without one, snapshots fall back to a software path.

What "on-device AI" means here: the tier is allowed to run heavier analytics like [Frigate](advanced.md#frigate-motion-alerts). It doesn't bundle Frigate — it just won't _suggest_ it on hardware that can't keep up.

> A plugged-in accelerator isn't the same as a _working_ accelerator. The tier is **advisory** — it tells features how hard to push — and it never promises a guaranteed frame rate.

---

## Getting the best picture

A few habits that help on any hardware, especially on a boat's marginal network:

- **Prefer H.264.** It plays reliably everywhere. If a camera offers both H.264 and H.265, use H.264. H.265 works best-effort but browser support is uneven.
- **Use the sub-stream on weak links.** Many cameras publish a low-resolution "sub-stream" alongside the main feed. It's much lighter and usually plenty for a glance at the foredeck.
- **Match the delivery mode to the moment.** Standard/HLS for everyday watching; low-latency/WebRTC when a second of delay matters; still-refresh as a last resort on a starved link. See [Watching video](viewing.md).
- **Don't record more than the tier allows.** The table above is the safe number of simultaneous recordings; pushing past it just drops channels.

---

## Storage & the disk

Anything that writes to disk — recordings, snapshots, incident bundles, cached Frigate clips — is kept to a **budget** and pruned oldest-first. The defaults are conservative (for example, recordings cap at roughly 10 GB and 48 hours), and pruning is designed so a full disk **can never brick the Signal K server**. If a single file can't be deleted, the rest are still pruned.

If you're tight on space on a Pi, lean on snapshots and incident bundles rather than continuous recording.

---

## Where to next

- **[Snapshots & recording](snapshots-and-recording.md)** — what recording costs in practice.
- **[Advanced features](advanced.md)** — the tier-gated features.
- **[Plugin configuration](../reference/configuration.md)** — the hardware-tier override and other settings.
