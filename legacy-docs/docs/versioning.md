# Versioning and migration

How JADE LENS versions its code and data, and how migrations work. This is the
canonical doc; `DESIGN.md §14` is the vision-level summary and points here.

The point of the system: let JADE LENS ship with an imperfect design and evolve
safely — start using a working-but-incomplete app and reshape both code and data
in lockstep across releases.

---

## Three independent version tracks

Each serves a different purpose and moves at its own pace.

### Python tooling / skill version (semver)

- **Covers:** the Python tooling (CLI / `jadelens-apply`, migration scripts,
  utility scripts) and the Claude Code `/jade` skill (SKILL.md, system-prompt
  content).
- **Format:** semver `MAJOR.MINOR.PATCH` — MAJOR = breaking changes to the skill
  interface, CLI interface, or operation format; MINOR = new features / op types /
  skill capabilities; PATCH = fixes, wording, performance.
- **Source of truth:** `__version__` in a top-level Python module. The rendered
  skill carries a version marker so the tooling can tell whether the installed
  skill is current.
- **Git tags:** `py-vMAJOR.MINOR.PATCH` (e.g. `py-v1.2.3`).
- **Changelog:** `changelogs/python/vX.Y.Z.md` — audience: `/jade` users.

### Web app version (semver)

- **Covers:** the React + Vite web app — UI, rendering, client logic, the sync
  layer; everything in the browser.
- **Format:** semver. MAJOR = large redesigns / breaking changes to how the app
  reads/writes data (rare — most data-interaction changes are captured by the data
  version instead); MINOR = new views/features; PATCH = fixes, styling, deps.
- **Source of truth:** `package.json` `version`.
- **Git tags:** `web-vMAJOR.MINOR.PATCH` (e.g. `web-v0.4.0`).
- **Changelog:** `changelogs/web/vX.Y.Z.md` — audience: web-app users; can be terse.
- The running version is shown in the UI (settings / about) so the user can see
  what they're on.

### Data format version (sequential integer)

- **Covers:** the data repo's structure/schema — file layout, `.jade/` contents,
  expected JSON fields, the operations-log format, anything the code assumes about
  the shape of the data.
- **Format:** a sequential integer — `1`, `2`, `3`, … **No semver**, because there
  is no "backwards-compatible data change" — every change is a migration that must
  be applied.
- **Source of truth:** `.jade/version` in the data repo. Both codebases hardcode
  the data version they require.
- **Git tags:** none. The data version is a property of the data repo; its history
  lives in the migrations and the operations log, not in tags.
- **Changelog:** `changelogs/data/vN.md` — describes the format change, the
  migration, and why. Audience: developers and the bot. Doubles as migration
  documentation.

---

## How the tracks interact

The three are fully independent: a web release doesn't imply a Python release or a
data bump, and vice versa. The only coupling:

- **Both codebases declare the data version they require** and check the data repo
  against it on every run. Mismatch handling differs per client (below).
- **A data-version bump always ships with a migration** in the Python/skill world.
- Data changes may freely break older code — there is **no forward-compatibility
  guarantee**. The code that requires a new data version ships *together* with the
  migration: when a code release needs data vN, push the code tag(s) and the
  migration at the same time so the usual flow (below) holds.

Operational consequence worth knowing: migrating the data forward via `/jade` can
put the **web app into read-only until it's redeployed** to support the new data
version. That's expected, not a bug — the web app auto-updates on reload, so in the
normal flow the matching web release is already live.

---

## No automatic code updates

We deliberately do **not** check for code updates on `/jade` invocation. The
per-interaction flow stays a data-repo pull/push only — no code-repo fetch bolted
onto it.

Rationale: the per-session skill auto-render only works when Claude is started
*from the data repo*, which is not the intended use. The intended use is **"use
Claude however and wherever you normally do; `/jade` is there when you need it."**

Instead, the Python/skill world ships a **manual update tool** (e.g. `jadelens
update` — final name TBD) that the user runs when they want. It updates the
installed `jadelens` (tooling + bundled skill template) and re-renders the skill.
It's also what the `data > code` abort message (below) points the user to.

The web app is the exception by nature: GitHub Pages always serves the latest
build, so users get the current version on their next load (subject to cache).
There is no opt-in flow.

---

## Version-mismatch handling

Automatic **data**-version checks *do* happen — on every `/jade` interaction and on
every web load. Two directions:

### Python / skill (`/jade`)

| Comparison | Action |
|---|---|
| `data == code` | Normal operation. |
| `data < code` | Run the migration flow (below). |
| `data > code` | The installed code is too old for this data (another device migrated forward). **Tell the user to run the update tool, then abort.** Don't attempt anything. |

### Web app

| Comparison | Action |
|---|---|
| `data == required` | Normal operation. |
| `data < required` | The data needs upgrading, but **the web app does not run migrations** (for now). Show a persistent, prominent warning to update the `jadelens` CLI and migrate via `/jade`. **Disable all editing — strictly read-only** — but still **try to render** (may be partial or broken; better than nothing). No "breaking vs non-breaking" distinction — every mismatch gets the same treatment. |
| `data > required` | Should basically never happen (the web app is always latest on reload). If it does: tell the user to reload; if that doesn't help, clear the cache and reload. |

### The usual end-to-end flow

1. User opens the web app → it auto-updates to the latest web build on load.
2. The app detects a data migration is needed (`data < required`).
3. It tells the user to upgrade the `jadelens` CLI on desktop and invoke `/jade` to
   migrate the data.
4. Meanwhile the web app is best-effort read-only and possibly broken.
5. After the migration, `data == required` and the app is fully functional.

This works because the code tags and the migration are pushed together (above).

---

## Migrations

### Bot-run, Python-assisted

Migrations are **run by the bot**, following a **markdown runbook** for the target
data version. The runbook interleaves two registers:

- **Natural-language instructions** for work that needs intelligence — e.g.
  *"rename files so their names never include verbs,"* *"merge duplicate research
  records on the same topic."*
- **Calls to Python helper scripts written for that migration** for everything
  mechanical — e.g. *"then run `migrations/v17.py` with the filepaths of all
  calendar-related files as arguments."*

The order is whatever the runbook dictates — interleaved, **not** "all Python, then
the bot finishes up." The guiding principle: **automate in Python whenever possible
to save tokens; use the bot only where intelligence is genuinely needed.** Renaming
a field across a year of records via bot-emitted patches would be prohibitively
expensive; a 10-line Python script over the same data is free, fast, and reliable.

> Exact file layout (e.g. a `migrations/vN.md` runbook plus `migrations/vN*.py`
> helpers, vs. a `migrations/vN/` directory) and its relationship to
> `changelogs/data/vN.md` are a detail to finalize at implementation.

### Who runs them

- **Now:** the Python tooling/skill is the sole migration runner (the bot, via
  `/jade`, following the runbook). The web app detects and warns only.
- **Future (bot in the web app):** the web app gains the ability to run migrations
  (authored JS scripts and/or the in-app bot), turning the "your data needs
  upgrading" message into a "click to upgrade" button. The Python path continues to
  support migrations for terminal users.

### Execution flow — keep the safety net

The original migration design's safety mechanisms are retained; do not lose them:

1. **Pre-check.** Ask the user to review the data — especially recent changes — and
   fix mistakes via natural-language correction or manual edits. This is their last
   chance before the shape changes (the one-way door).
2. **Checkpoint.** On confirmation, create a checkpoint tag in the data repo
   (e.g. `pre-migration-<from>-to-<to>`).
3. **Collect.** Gather every migration whose target is in
   `(data-version, required-version]`, in order.
4. **Dry-run summary.** Show the user what each migration will do; confirm before
   applying.
5. **Apply, per migration in sequence:** run the runbook (bot + Python helpers; all
   data changes go through the standard operation pipeline) → bump `.jade/version` →
   write an operations-log entry describing the migration → commit. One atomic
   commit per migration = a clean version boundary to resume from.
6. **Push.**
7. **Fresh ops-log.** Start a new `.jade/operations-log/<version>.jsonl` for the new
   data version; the previous file stays for history (DESIGN §7.2).

**On failure / interruption** (browser crash, killed session, a failed step):
because the version is bumped only inside each migration's own commit, the next run
still sees `data < required` and re-engages. Recovery: **reset to the
pre-migration checkpoint tag and retry from scratch.** Individual migrations need
**not** be idempotent — subjective bot steps can't guarantee it; reset-then-retry
sidesteps the problem.

### One-way door

Operations-log entries from before a migration reference shapes that no longer
exist afterward. They stay readable as history but can't be meaningfully
re-applied. The pre-check (step 1) is the user's chance to fix things before the
door closes; the checkpoint messaging must make this clear.

### Testing discipline

Before shipping a migration in a release, run it against a snapshot of pre-version
data and verify the result — catch breakage at release time, not at the user's
startup. Especially important because the bot executes part of it: a migration that
worked yesterday may behave differently as models/prompts drift. Pinning the model
version used during a migration run is worth considering.

---

## Changelog layout

```
changelogs/
  python/   vX.Y.Z.md   (skill + tooling; audience: /jade users)
  web/      vX.Y.Z.md   (UI + app; audience: web users; may be terse)
  data/     vN.md        (data format + migration doc; audience: devs + the bot)
```

Per-track directories, one file per version — keeps changelogs focused instead of a
monolithic CHANGELOG mixing unrelated changes. This replaces the current flat
`changelogs/v0.1.0.md`, which is split into the per-track layout when the system is
adopted (see BACKLOG → "Seed version tracks and changelog layout").

---

## Git tags

| Tag | Example | Meaning |
|---|---|---|
| `py-vMAJOR.MINOR.PATCH` | `py-v1.2.3` | Python tooling/skill release |
| `web-vMAJOR.MINOR.PATCH` | `web-v0.4.0` | Web app deployment |

No tags for the data version. Tags are created at the version-bump commit (for the
web app, the commit that triggers the GitHub Pages deploy). When a code release
requires a new data version, push the code tag(s) **and** the migration together.

If the project ever splits into two repos (Python, web), drop the prefixes and use
plain `vMAJOR.MINOR.PATCH` tags per repo.

---

## Summary

| Aspect | Python tooling/skill | Web app | Data format |
|---|---|---|---|
| Format | semver | semver | sequential integer |
| Source of truth | Python `__version__` | `package.json` | `.jade/version` |
| Git tags | `py-vX.Y.Z` | `web-vX.Y.Z` | none |
| Changelog | `changelogs/python/` | `changelogs/web/` | `changelogs/data/` |
| Update | manual update tool | page reload (always latest) | migration |
| On `data < code` | run migration | warn + read-only, point to `/jade` | — |
| On `data > code` | tell user to update, abort | reload (then clear cache) | — |
| Migration runner | bot via `/jade`, Python-assisted (sole runner for now) | detects + warns only (for now) | — |
| Audience | `/jade` users | web users | devs + the bot |
