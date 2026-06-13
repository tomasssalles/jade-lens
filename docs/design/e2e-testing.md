# E2E test harness

The unit tests and conformance suite verify that individual components behave
correctly in isolation. What they cannot cover is **multi-version scenarios**:
a v1 data repo being migrated to v2 by the bot, a CLI v0.1.0 install running
`post-update` to reach v0.2.0, the web app in read-only mode because data is
ahead of the required version, version-mismatch error paths. This document
describes the harness for setting up and running those scenarios repeatably.

Source of truth: `tests/e2e/` (harness script + fixtures), `web/src/devSeed.js`
(web app dev-seed). Related: [versioning.md](versioning.md) (the version system
being tested), [claude-code-integration.md](claude-code-integration.md)
(install/update flow).

## What "testing" means here

The harness is **not an automated test runner and does not integrate with CI.**
Bot interactions cost real money and involve judgment that doesn't automate well;
they are always run by the developer personally, in a real Claude session. The
harness handles everything *around* the bot:

- **Setup:** materializing a fresh data repo in a known state from a stored
  fixture.
- **Isolation:** sandboxing CLI installs, home symlinks, and credentials so test
  activity never touches real data repos or the developer's real
  `~/.claude/skills/`.
- **Web app:** pre-loading the test repo URL and PAT so the web app points at
  the right place immediately, without manual Settings entry.

The developer runs `materialize.py`, then manually exercises the scenario (with
or without a Claude session), then resets by running `materialize.py` again.

## Core concept: materialize-fresh

Resetting a scenario by rewinding an existing repo (force-pushing, removing
tags, reverting commits) is fragile and error-prone. Instead, each run
**materializes a completely fresh repository** from a stored snapshot of files.
Reset = delete the sandbox and re-run `materialize.py`. There is no incremental
state to untangle.

Fixture snapshots contain only the **data** — `.jade/version`,
`.jade/config.json`, `Index.json`, and any content files. Scaffold files
(session-start hook, `.claude/settings.json`, CLAUDE.md, `.gitignore`) are
written at materialize time from the installed `jadelens` templates, so they
always match the CLI under test and don't need to be stored in the fixture.

## Fixture format

Fixtures live under `tests/e2e/fixtures/<scenario-name>/` and mirror the data
repo structure directly:

```
tests/e2e/fixtures/
  v1-basic/
    .jade/
      version           ← "v1\n"
      config.json       ← see below
    Index.json          ← "[]"
    <content files…>
  v2-sidecars/
    .jade/
      version           ← "v2\n"
      config.json
    Index.json
    <content files with sidecar wikilinks…>
```

Every fixture uses the canonical test assistant name `jadetest` in
`.jade/config.json`:

```json
{
  "user": {"full_name": "Test User", "short_name": "Test"},
  "assistant": {"name": "jadetest"}
}
```

This ensures skills appear as `/jadetest` and `/jadetest-migrate`, home
symlinks never collide with the developer's real `/jade`, and the test
assistant name is visually distinct in any Claude session.

## Sandbox layout

`materialize.py` creates and populates a fresh sandbox under
`/tmp/jl-e2e/<scenario-name>/` on each run, **wiping it completely** if it
already exists:

```
/tmp/jl-e2e/<scenario>/
  home/          ← fake HOME: uv tool dir, ~/.claude/skills/, git credentials
  remote.git/    ← bare local git remote (local mode only; absent in --github mode)
  repo/          ← the materialized data repo
```

The **fake HOME** isolates all global state: the `jadelens` uv tool
installation, `~/.claude/skills/` symlinks, and git credential storage. Nothing
leaks into the developer's real HOME.

## Two modes

### Local mode (default)

```bash
python tests/e2e/materialize.py v1-basic
```

`origin` is a local bare git repo at `/tmp/jl-e2e/<scenario>/remote.git`. No
network, no GitHub. All `git push` / `git pull` calls in CLI operations operate
against it. Suitable for testing CLI paths, the migration state machine,
`post-update --data-repo`, version guards, and anything that doesn't involve
the web app.

Cannot be used for web app testing: the web app speaks the GitHub REST API and
cannot read a `file://` remote.

### `--github` mode

```bash
python tests/e2e/materialize.py v1-basic --github
```

`origin` is the GitHub test repo (URL configured in `.env.local` — see below).
The local bare remote is skipped entirely. After materializing the repo locally,
`materialize.py`:

1. Validates the GitHub test repo name against the safety pattern (see below).
2. Clears all migration tags from the remote matching
   `^v\d+-v\d+-migration-(start|end)$`. Other tags, branches, and repo settings
   are not touched.
3. Force-pushes `main` to the GitHub test repo.

The local data repo's `origin` points directly at the GitHub test repo, so
the CLI, bot sessions, and the web app all share one substrate: commits pushed
by `jadelens apply` are immediately visible to the web app on refresh.

**Safety guard.** The GitHub test repo name (the portion after `owner/` in the
URL) must match `r"jade-lens-test(-.+)?"` (e.g. `jade-lens-test` or
`jade-lens-test-2`). `materialize.py` validates this before any network
operation and exits with a clear error if it doesn't match. This guard exists
because GitHub Free does not allow branch protection on private repos, so the
only safeguard against an accidental force-push to a real data repo is in the
script itself.

## Auth in `--github` mode

The fake HOME contains no SSH keys or Git credential helper. All GitHub access
uses a fine-grained PAT scoped to **only the test repo** with `Contents:
read/write`. The PAT is embedded directly in the HTTPS remote URL:

```
https://<PAT>@github.com/<owner>/<repo>.git
```

This URL is set as `origin` in the materialized repo's `.git/config`. No
credential helper is needed; the PAT never reaches the developer's real
credential store; and the limited scope means a leaked test PAT cannot touch
any other repo.

The same PAT is pre-loaded into the web app via the dev-seed (see below), so
the web app can also read/write the test repo without any manual Settings entry.

## Bot sessions

For scenarios that involve a Claude session (e.g. running `/jadetest-migrate`),
the skill is discovered via `--add-dir`, not via a home symlink. The developer
runs:

```bash
export HOME=/tmp/jl-e2e/<scenario>/home
export PATH="$HOME/.local/bin:$PATH"
claude --add-dir /tmp/jl-e2e/<scenario>/repo
```

`--add-dir` makes Claude discover `.claude/skills/jadetest/` from the test
repo's directory. No home symlink is needed for the session to find the skill.
The fake HOME is still set so that any CLI commands the session-start hook or
the bot triggers (uv installs, `post-update`, etc.) land in the sandbox and not
in the developer's real HOME.

The session-start hook will attempt to create a home symlink at
`$HOME/.claude/skills/jadetest`; this lands inside the sandbox HOME, which is
fine. `materialize.py` prints the exact `export` and `claude` commands to run
at the end of every invocation.

## Configuration: `.env.local`

A single gitignored file at the **repository root** holds all test credentials
and configuration:

```
# .env.local  (gitignored — never commit)
VITE_JL_E2E_REPO_URL=https://github.com/tomasssalles/jade-lens-test
VITE_JL_E2E_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
```

The `VITE_` prefix is required for Vite to expose these values to browser code
at build/dev time. `materialize.py` reads the file with simple `key=value`
parsing and uses the values regardless of the prefix.

`vite.config.js` is configured with `envDir: path.resolve(__dirname, '..')` so
Vite picks up the root-level `.env.local` automatically, with no changes needed
to the `web/` directory structure.

An `.env.local.example` file (tracked, no real credentials) documents the
required keys and their expected format.

## Web app dev-seed

`web/src/devSeed.js` is a small module imported in `main.jsx`. It is **entirely
gated on `import.meta.env.DEV`**, which Vite replaces with `false` in
production builds — the code is dead and tree-shaken out of the GitHub Pages
bundle.

In dev mode, on startup, if `VITE_JL_E2E_REPO_URL` and `VITE_JL_E2E_PAT` are
set, the seed:

1. Writes `{ githubRepoUrl: …, githubPat: … }` into the `config` store in
   IndexedDB, keyed `'user'` (the same key Settings reads and writes).
2. Clears the `repo`, `sync`, and `drafts` stores so the app fetches fresh from
   the test repo rather than serving stale cache from a previous scenario.

The result: `npm run dev` with `.env.local` present points the web app at the
test repo immediately, with a clean cache. No manual Settings entry is needed.
Changing the scenario (re-running `materialize.py --github`) and reloading the
browser is sufficient to reset the web app's view.

This seed is the first instance of the "dev-only code stripped from the Pages
build" pattern. Future dev-only settings (Advanced panel, feature flags) should
follow the same `import.meta.env.DEV` gate.

## Source layout

```
tests/e2e/
  materialize.py       ← the single harness script
  fixtures/
    v1-basic/          ← scenario: v1 data repo with promotable string values
    …
.env.local             ← gitignored; real credentials (never commit)
.env.local.example     ← tracked; documents required keys, placeholder values
web/src/devSeed.js     ← dev-only IDB seed; imported in main.jsx; DEV-gated
```
