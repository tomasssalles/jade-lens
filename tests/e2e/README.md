# E2E test harness — practical guide

Hands-on guide for running multi-version scenarios (migrations, version
mismatches, CLI/web updates) against a fresh data repo. For the *why* and the
design rationale, see [`docs/design/e2e-testing.md`](../../docs/design/e2e-testing.md).

These are manual scenarios you drive yourself — nothing here runs in CI, and
bot steps are always you in a real Claude session.

---

## 1. Pick your test case

Scenarios live as fixtures under `fixtures/`:

```
fixtures/
  v1-basic/       v1 data repo with promotable string values (for migration tests)
  …
```

Each fixture is just a snapshot of data files (`.jade/`, `Index.json`, content).
To add a new one, copy an existing fixture directory and edit the files. Keep
the assistant name as `jadetest` in `.jade/config.json`.

---

## 2. Materialize the data repo

This creates a fresh sandbox at `/tmp/jl-e2e/<fixture>/` and wipes any previous
run. **Re-run this any time to reset the scenario from scratch.**

**Local mode** — CLI/bot only, no GitHub, no web app:

```bash
python tests/e2e/materialize.py v1-basic
```

**GitHub mode** — needed when the web app is involved (it reads the GitHub API):

```bash
python tests/e2e/materialize.py v1-basic --github
```

GitHub mode force-pushes to the test repo configured in `.env.local` (see
[setup](#0-one-time-setup) below). It is guarded: the repo name must match
`jade-lens-test(-.+)?`.

The script prints the sandbox paths and the exact commands to run next — copy
them from its output.

---

## 3. Install a specific CLI version in the sandbox

All CLI work happens under the **fake HOME** so it never touches your real
`jadelens` install or your real `~/.claude/skills/`:

```bash
export HOME=/tmp/jl-e2e/v1-basic/home
export PATH="$HOME/.local/bin:$PATH"
```

Then install the version you want into that sandbox:

```bash
# Your current working copy (most common — testing your own changes):
uv tool install --from /home/user/jade-lens jadelens

# A released version, by tag:
uv tool install "git+https://github.com/tomasssalles/jade-lens.git@cli-v0.1.0"

# The moving "latest" tag (what a real cold session installs):
uv tool install "git+https://github.com/tomasssalles/jade-lens.git@cli-latest"
```

Verify it's the sandbox copy:

```bash
which jadelens          # → /tmp/jl-e2e/v1-basic/home/.local/bin/jadelens
jadelens --version
```

To swap versions mid-scenario, `uv tool install --reinstall …` with a different
ref. To start completely clean, just re-materialize (step 2).

---

## 4. Run a specific web app version with prefilled settings

The web app version is selected with a **git worktree** so your dev checkout
stays untouched. Each worktree gets its own isolated `node_modules`.

```bash
# Check out the version you want into a throwaway dir:
git worktree add /tmp/jl-web-v0.1.0 web-v0.1.0     # tag, branch, or SHA
cd /tmp/jl-web-v0.1.0/web
npm ci

# Run it (dev server, no build needed):
npm run dev        # → http://localhost:5173/jade-lens/
```

The dev-seed reads `.env.local` at the repo root and, in dev mode only,
pre-fills the test repo URL + PAT into Settings and clears the cache on
startup — so the app points at your test repo immediately, no manual setup.

To reset the web app's view after re-materializing: just reload the page (the
dev-seed clears the cache on every load).

Run multiple versions side by side on different ports:

```bash
npm run dev -- --port 5174
```

Clean up a worktree when done:

```bash
git worktree remove /tmp/jl-web-v0.1.0
```

> Use `--github` mode (step 2) for any web app scenario. The web app cannot read
> the local bare remote used by local mode.

---

## 5. Use the bot in the sandbox

Bot sessions find the skill via `--add-dir` (no home symlink needed). With the
fake HOME still exported from step 3:

```bash
export HOME=/tmp/jl-e2e/v1-basic/home
export PATH="$HOME/.local/bin:$PATH"
claude --add-dir /tmp/jl-e2e/v1-basic/repo
```

Inside the session the skill is `/jadetest` (and `/jadetest-migrate` for
migrations) — distinct from your real `/jade`, so there's no collision. Any CLI
commands the bot or the session-start hook runs land in the sandbox HOME.

Example — running a migration end to end:

```
> /jadetest-migrate
```

Then follow the runbook prompts yourself. When done, re-materialize (step 2) to
run it again from a clean v1 state.

---

## 0. One-time setup

Create `.env.local` at the **repo root** (copy from `.env.local.example`):

```
VITE_JL_E2E_REPO_URL=https://github.com/<owner>/jade-lens-test
VITE_JL_E2E_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
```

- The repo must already exist on GitHub (the harness does not create it) and its
  name must match `jade-lens-test(-.+)?`.
- The PAT should be **fine-grained, scoped to only the test repo**, with
  `Contents: read/write`. Its limited scope is the safety net — even if leaked,
  it can't touch any other repo.
- `.env.local` is gitignored. Never commit it.

Both `materialize.py --github` and the web app dev-seed read this one file.
