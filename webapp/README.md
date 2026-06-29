# SK Video web app

The SK Video operator console — a React + Vite single-page app **served same-origin by the plugin** at `/plugins/sk-video/app/`. It is a self-contained project (its own `package.json` and lockfile, like `e2e/`), kept out of the plugin's `src/` so the plugin's `tsc` build and coverage ratchet are untouched.

## Why it lives here

One repo means the API and the UI version together — no cross-repo skew. The app talks to the plugin over the same-origin HTTP API (`/plugins/sk-video/*`); it never reaches go2rtc or a camera directly. It reuses the plugin's exported TypeScript interfaces via type-only imports where helpful.

## Develop

```sh
npm --prefix webapp install      # one-time
npm --prefix webapp run dev      # Vite dev server
npm --prefix webapp run test     # vitest (jsdom)
npm --prefix webapp run lint
npm --prefix webapp run build    # → ../public (what the plugin serves and ships)
```

`vite.config.ts` sets `base: '/plugins/sk-video/app/'` and builds to the repo's `public/` directory. The plugin's `src/web/app-routes.ts` serves that directory under the same path with hashed-asset immutability and a `no-store` `index.html`.

## Boundary

This app owns full **management, playback, review, and the safety console**. Clients like the KIP Video widget own only per-instance presentation and link out here to manage. See the plan and `docs/` for the full client-boundary model.

> Scaffold status: the shell proves the serving + same-origin API contract. The screens (Live Wall, Camera Focus, DVR, Incidents, Events, Cameras, Settings) land in later phases, informed by the design work.
