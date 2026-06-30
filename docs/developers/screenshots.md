# Regenerating screenshots

The screenshots in these docs are **generated, not hand-captured** — so they stay accurate as the UI changes. This page explains the pipeline and how to refresh them.

The whole thing lives in [`e2e/screenshots/`](../../e2e/screenshots/) and runs against the same throwaway Docker stack as the e2e tests, seeded with **stable, realistic demo data** so the same shots come out the same way every time.

---

## One command

```sh
cd e2e/screenshots
./capture-all.sh --copy            # bring up the stack, seed it, capture, copy into docs/images/
./capture-all.sh --admin --copy    # only the shots that don't need KIP (fast, always works)
```

That script (`e2e/screenshots/capture-all.sh`):

1. brings up the demo stack (Signal K + the plugin + a simulated MediaMTX camera) on `:3010`,
2. seeds **deterministic** demo data with [`seed-demo.sh`](../../e2e/seed-demo.sh) — four named cameras (Foredeck, Cockpit, Engine Room, Masthead), a sample uploaded clip, and a burst of live telemetry,
3. runs the Playwright capture specs into `e2e/screenshots/out/`,
4. with `--copy`, copies the published set into `docs/images/`.

Stop the stack afterwards with `./run.sh --down` from `e2e/`.

---

## Two kinds of shot

| Kind | Needs | Specs |
| --- | --- | --- |
| **Admin** (the plugin config page) | only the core stack | `admin.spec.ts` |
| **Widget** (the live video UI) | KIP built + mounted | `capture.spec.ts`, `recapture-docs.spec.ts`, `ux-states.spec.ts` |

The admin shots are the reliable ones — they only need Signal K + the plugin running, so `./capture-all.sh --admin` always works. The widget shots drive the **KIP Video widget** (a separate repo), so they need KIP built and mounted via the compose file's `${KIP_PATH:-../../kip}` mount.

---

## Why the KIP harness is the way it is

KIP is a PWA that owns its own `localStorage` config and will _first-run reset_ an injected dashboard back to its tutorial widget — every time — unless you fight it on three fronts. That hard-won fix lives once in [`kip-harness.ts`](../../e2e/screenshots/kip-harness.ts):

1. **`bootstrapKip()`** clicks "Load Demo" first, writing a complete valid config so KIP stops first-run-resetting.
2. **`setDashboard()`** re-injects the dashboard via `addInitScript` on _every_ navigation, beating KIP's `beforeunload` save-clobber.
3. **`serviceWorkers: 'block'`** (in `screenshots.config.ts`) stops the worker reloading the page mid-capture.

Don't re-derive these helpers in a new spec — import them. Duplicated copies are how the tutorial-clobber bug kept coming back.

---

## Stable, realistic data

The point of `seed-demo.sh` is that the data is **the same across generation sessions**, so a refreshed screenshot differs only where the UI actually changed — not because a random camera name or a different clip showed up. It registers fixed camera names/roles, uploads a known sample clip, and injects a fixed telemetry burst (position, heading, speed, depth, wind). If you want the "video playing" hero to show real footage, point it at your own clip with `HERO_CLIP=/path/to.mp4 ./seed-demo.sh`.

---

## Adding a new screenshot to the docs

1. Add a capture step to the right spec (admin → `admin.spec.ts`; a KIP view → `capture.spec.ts` or a focused spec), using the `shot(page, 'my-name', target?)` helper.
2. Add the name to the copy list at the bottom of `capture-all.sh`.
3. Reference `../images/<name>.png` from the doc.
4. Run `./capture-all.sh --copy` (or `--admin --copy`) and commit the new PNG alongside the doc.

Keep names descriptive and stable — they're the filenames the docs link to.
