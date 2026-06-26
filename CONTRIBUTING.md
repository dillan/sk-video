# Contributing to SK Video

Thanks for helping out! This guide covers how to set up, make changes, and get them merged.

## Set up

See [**For developers → Develop**](README.md#develop) in the README for prerequisites, the install
steps, the script list, and how to run your changes against a Signal K server. In short:

```sh
npm install
npm run dev      # rebuild as you edit
npm test         # run the tests
```

## Before you open a pull request

Run the same checks CI runs, so there are no surprises:

```sh
npm run format:check   # formatting (npm run format fixes it)
npm run lint           # code problems
npm run build          # it compiles
npm test               # tests pass
```

We write tests first where we can: add a failing test that proves the behavior you want, then make it
pass. Keep credentials and secrets out of the code, tests, and fixtures — use placeholder hostnames
(`example.com`) and fake logins. Camera logins are handled on the server only and are never returned
to the browser or written into shared config.

## Commit messages: Conventional Commits (this matters)

Every release is created automatically from commit messages, so the format is not optional. Use
[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary in plain language>
```

| Type       | When to use it                          | Effect on the next release |
| ---------- | --------------------------------------- | -------------------------- |
| `feat`     | A new feature                           | New **minor** version      |
| `fix`      | A bug fix                               | New **patch** version      |
| `docs`     | Documentation only                      | No release                 |
| `test`     | Adding or fixing tests                  | No release                 |
| `refactor` | Code change that isn't a feature or fix | No release                 |
| `chore`    | Tooling, dependencies, housekeeping     | No release                 |
| `ci`       | CI/CD configuration                     | No release                 |
| `style`    | Formatting only                         | No release                 |

A breaking change adds a `!` (e.g. `feat!: ...`) or a `BREAKING CHANGE:` footer and triggers a new
**major** version.

Examples:

```
feat: add a snapshot button to the camera view
fix: stop the gateway from leaking go2rtc connections on disconnect
docs: explain the local development loop
```

The commit message is checked automatically (locally via a git hook, and in CI). If a commit is
rejected, reword it with `git commit --amend`.

## Pull requests

- Branch off `main`.
- Keep changes focused; smaller PRs are easier to review.
- The PR title should also follow the Conventional Commits format — it becomes the squash-merge commit.
- Fill in the PR template (what changed, why, how it was tested).

## Releases

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io/). When
commits land on `main`, it works out the next version from the commit messages, updates the
changelog, tags the release, and publishes to npm.

Publishing uses npm **trusted publishing** (OIDC) — there is no npm token stored in the repo. The
release workflow is held back by a repository variable until publishing is set up:

1. Publish the package to npm once by hand to create it (`npm publish` from a clean build).
2. On npmjs.com, open the package's **Settings → Trusted Publisher** and add a GitHub Actions
   publisher: organization/user `dillan`, repository `sk-video`, workflow `release.yml`.
3. In the GitHub repo, set the variable **`RELEASE_ENABLED`** to `true`
   (Settings → Secrets and variables → Actions → Variables).

After that, every merge to `main` releases automatically with no tokens to manage.
