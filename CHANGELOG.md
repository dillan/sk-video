## [1.0.1](https://github.com/dillan/sk-video/compare/v1.0.0...v1.0.1) (2026-06-26)


### Bug Fixes

* treat a JSON array in a persisted store file as empty ([6e4db66](https://github.com/dillan/sk-video/commit/6e4db665ad44cf0cba4fae5b37975dc94c3b6b51))

# 1.0.0 (2026-06-26)


### Bug Fixes

* use current go2rtc asset names and extract zip archives ([ab6497c](https://github.com/dillan/sk-video/commit/ab6497cb440b4601a31fa96bfe7716c99e301c69))


### Features

* add credentials endpoint and SSRF host validation ([c9ac17d](https://github.com/dillan/sk-video/commit/c9ac17d8a04d2ccd3bfc3ad1595e674b99c5fb8d))
* add host-resolution SSRF check with DNS-rebinding defense ([1b9f664](https://github.com/dillan/sk-video/commit/1b9f6641ae09d667918af47960cb09a9a8ecc4d4))
* add ONVIF connection factory and PTZ manager ([a881adf](https://github.com/dillan/sk-video/commit/a881adf82c8bbf21e80118d430318a609748a1a5))
* add the camera store ([9ad9a8e](https://github.com/dillan/sk-video/commit/9ad9a8e7769a4207ae86027ede6e7ec6c4dbb7b8))
* add the ONVIF PTZ controller with auto-stop safety ([709bd77](https://github.com/dillan/sk-video/commit/709bd7731fafa03ec730a154825aed53e9667ec2))
* add the same-origin transport proxy (WHEP, frame, HLS) ([0d37564](https://github.com/dillan/sk-video/commit/0d375644b5e5dd35bc7094e2f3f486717429498a))
* add the server-side credential store ([9e71484](https://github.com/dillan/sk-video/commit/9e71484b83b626da208f3c122c2090c7c626d9a2))
* add the SK Video plugin entry and the cameras resource provider ([2eade59](https://github.com/dillan/sk-video/commit/2eade5983a8409e7927de0bf088f0c013691da82))
* add the SSRF egress guard ([f67d4f2](https://github.com/dillan/sk-video/commit/f67d4f2fccdcd82b9cf174bb0c988c55b8a687c1))
* build go2rtc source URLs from validated camera fields ([1812801](https://github.com/dillan/sk-video/commit/18128015df5bbc620b4198dfe9819c74573e99a9))
* build loopback go2rtc proxy URLs keyed by camera id ([e22c48e](https://github.com/dillan/sk-video/commit/e22c48ed14c0605d22234b87842e74541889ec6a))
* clamp PTZ velocities and validate preset tokens ([ec3255b](https://github.com/dillan/sk-video/commit/ec3255bc5201336bb7184ca20ea98cde88c05af0))
* expose ONVIF PTZ routes from the plugin ([a26ba45](https://github.com/dillan/sk-video/commit/a26ba45bee5a3755b29b2147fa2a588b45ddb37e))
* generate the go2rtc configuration ([59ebed3](https://github.com/dillan/sk-video/commit/59ebed3b884547f79ff329f985af7b754dade378))
* manage the go2rtc binary (locate, download, verify, chmod) ([35533f8](https://github.com/dillan/sk-video/commit/35533f89b885cf1b28ef71f4c30281f3d514591c))
* map go2rtc release assets and build download URLs ([ee8f515](https://github.com/dillan/sk-video/commit/ee8f51543a792fdd38e30df11408701e6b86db48))
* reconcile go2rtc with the configured cameras ([23b01db](https://github.com/dillan/sk-video/commit/23b01dbb44747d193e05edecc814c444d8c2ef83))
* redact URL credentials for safe logging ([1872d5f](https://github.com/dillan/sk-video/commit/1872d5f7d170669e04090ad12c78b5672a966e9d))
* run and proxy go2rtc from the plugin with debounced reconcile ([620c7d2](https://github.com/dillan/sk-video/commit/620c7d2585cd9e6cb2843aeb56fbdfd163bb5dac))
* serve cameras through the Signal K resource provider ([b206a60](https://github.com/dillan/sk-video/commit/b206a60ceb3ff30f4c1d7c10f35c8f203a45a707))
* supervise the go2rtc child process (spawn, restart, kill) ([c6f79d3](https://github.com/dillan/sk-video/commit/c6f79d37cd67cd87950220c805f0f898eb9843b0))
* validate and normalise camera definitions ([b850021](https://github.com/dillan/sk-video/commit/b850021495f7477140cf4146b03198fc6b33d2d4))
* verify downloaded binaries against a SHA-256 digest ([0a24773](https://github.com/dillan/sk-video/commit/0a24773e20a016b4885bcdcebd43e7f2b500829d))

# Changelog

All notable changes to **SK Video** are documented in this file. From the first release onward it is
maintained automatically by [semantic-release](https://github.com/semantic-release/semantic-release)
from [Conventional Commits](https://www.conventionalcommits.org/).

## Unreleased

- Plugin skeleton and a custom `cameras` Signal K resource provider (P1): validated camera
  definitions (stream-scheme allow-list + injection guards), a file-backed store in the plugin data
  directory, and a `GET /plugins/sk-video/status` endpoint.
