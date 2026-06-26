// Installs the local git hooks (simple-git-hooks) for contributors.
//
// Runs with all output silenced on purpose: `npm` executes `prepare` during `npm pack`, and tools
// that parse `npm pack --json` (e.g. the Signal K plugin validator) break if a prepare script writes
// to stdout. This never fails the install — a missing or unavailable hook runner is fine in CI and
// for users installing the published package.
import { spawnSync } from 'node:child_process';

// Single command string (not an args array) to avoid the shell-args deprecation warning while
// keeping cross-platform `npx` resolution.
spawnSync('npx --no-install simple-git-hooks', { stdio: 'ignore', shell: true });
