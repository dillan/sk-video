# AGENTS.md

Context for AI coding agents (and humans) working in this repo. Read this first.

## What this is

SK Video is a TypeScript **Signal K server plugin**. It manages a [go2rtc](https://github.com/AlexxIT/go2rtc) gateway that repackages RTSP/RTMP/ONVIF cameras into browser-playable **WebRTC / HLS / MJPEG**, exposes cameras through a custom `cameras` Signal K resource type, proxies **ONVIF PTZ**, runs **WS-Discovery + mDNS**, and stores/serves uploaded video with HTTP Range. The plugin entry is `src/index.ts`; it exports `(app) => Plugin`.

## Commands

```sh
npm run build          # tsc -> dist/
npm run dev            # tsc --watch
npm test               # vitest run
npm run test:coverage  # vitest with coverage
npm run lint           # eslint
npm run format         # prettier --write .
npm run format:check   # prettier --check . (what CI enforces)
```

Run `format:check`, `lint`, `build`, and `test` before committing — that's the CI gate.

## Source layout (`src/`)

| Directory    | Responsibility                                                             |
| ------------ | -------------------------------------------------------------------------- |
| `cameras/`   | Camera store, the `cameras` resource provider, write-only credential store |
| `gateway/`   | go2rtc binary management, process supervision, same-origin transport proxy |
| `onvif/`     | ONVIF PTZ controller, command building, PTZ routes                         |
| `discovery/` | WS-Discovery + mDNS probes, scan throttling, discovery routes              |
| `uploads/`   | Hardened asset store, magic-byte sniffing, HTTP Range, quota               |
| `security/`  | SSRF egress guard, log redaction                                           |

Tests live next to the code as `*.spec.ts` and run on `node` (no DOM).

## Conventions

- **Test-first.** Add a failing `*.spec.ts` that proves the behavior, then implement.
- **Conventional Commits are required** — releases are generated from them. See [CONTRIBUTING.md](CONTRIBUTING.md). Valid types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `style`, `build`, `perf`. Only `feat`/`fix`/`perf` cause a release.
- **No AI attribution in commits or PRs** (no `Co-Authored-By`, no "Generated with").
- **Plain language** in user-facing docs and messages — write for a non-technical boater.
- **Scrub secrets and real hosts** from code, tests, and fixtures. Use `example.com` and fake logins.

## Security invariants (don't regress these)

- The browser is **same-origin only** — it never reaches go2rtc (`:1984`) or a camera IP directly. Everything is proxied through `/plugins/sk-video/*`, keyed by an internal camera id. A client-supplied `src=` is never honoured.
- **Camera credentials are server-side only.** They are never returned in the `cameras` resource or synced into widget config; they're written through a write-only endpoint.
- Stream sources are built from **validated structured fields** with a scheme allow-list — never pass raw user strings to `go2rtc.yaml` (blocks `exec:`/`ffmpeg:`/`pipe:` sources).
- The SSRF guard denies loopback, link-local, and cloud-metadata IPs and re-checks resolved IPs before connecting (DNS-rebinding defence).
- Uploads are validated by **magic bytes**, served with `nosniff` and vetted Range handling.

## End-to-end harness (`e2e/`)

Docker + Playwright (Chromium + WebKit) with a simulated camera (MediaMTX), a real Signal K server, and an opt-in virtual ONVIF device. `cd e2e && ./run.sh`. See [`e2e/README.md`](e2e/README.md).

> **Gotcha:** multicast (WS-Discovery / mDNS) does **not** cross Docker Desktop on macOS or Windows, so live camera _discovery_ only works on Linux or against a real LAN. Seed cameras manually on a Mac.
