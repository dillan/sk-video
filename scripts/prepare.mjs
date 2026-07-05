// Installs the local git hooks (simple-git-hooks) for contributors. Run it once after cloning:
//
//   npm run hooks
//
// This is DELIBERATELY a plain script, not a `prepare`/`postinstall` lifecycle hook. A lifecycle
// script ships in the published package.json, and modern npm then warns end users at install time
// ("allow-scripts: 1 package has install scripts…") even though it never runs on a registry/tarball
// install — an alarming, needless prompt for a plugin that does nothing at install. Keeping hook
// setup manual means the published package carries no install scripts at all.
//
// Output is silenced on purpose so nothing ever pollutes tooling that parses npm output.
import { spawnSync } from 'node:child_process';

// Single command string (not an args array) to avoid the shell-args deprecation warning while
// keeping cross-platform `npx` resolution.
spawnSync('npx --no-install simple-git-hooks', { stdio: 'ignore', shell: true });
