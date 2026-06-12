# Versioning and migration

How JADE LENS versions its code and data, and how migrations work. The point of
the system: let JADE LENS ship with an imperfect design and evolve safely — start
using a working-but-incomplete app and reshape both code and data in lockstep
across releases.

> **Status: designed, not yet built.** The version *tracks* aren't seeded, the
> data-version checks aren't wired, and there's no migration runner or update tool
> yet — all tracked in [the backlog](../planning/backlog.md). This
> doc is the intended design.

Related: [audit-and-correction.md](audit-and-correction.md) (the operations log a
migration appends to and rolls over), [claude-code-integration.md](claude-code-integration.md)
(where the `/jade` update tool and the version-pinned skill install live),
[bot-interaction.md](bot-interaction.md) / [web-app.md](web-app.md) (the two
clients that check the data version).

## Three independent version tracks

Each serves a different purpose and moves at its own pace. (Changelog directory
names follow [docs/README.md](../README.md): `cli/`, `web/`, `data-format/`.)

### Python tooling / skill version (semver)

- **Covers:** the Python tooling (the `jadelens` CLI incl. `jadelens apply`,
  migration scripts, utilities) and the Claude Code `/jade` skill (SKILL.md,
  system-prompt content).
- **Format:** semver `MAJOR.MINOR.PATCH` — MAJOR = breaking changes to the skill
  interface, CLI interface, or operation format; MINOR = new features / op types /
  skill capabilities; PATCH = fixes, wording, performance.
- **Source of truth:** `__version__` in the Python package. The rendered skill
  carries a version marker so the tooling can tell whether the installed skill is
  current.
- **Git tags:** `cli-vMAJOR.MINOR.PATCH` (e.g. `cli-v1.2.3`).
- **Changelog:** `docs/changelogs/cli/vX.Y.Z.md` — audience: `/jade` users.

### Web app version (semver)

- **Covers:** the React + Vite web app — UI, rendering, client logic, the sync
  layer; everything in the browser.
- **Format:** semver. MAJOR = large redesigns / breaking changes to how the app
  reads/writes data (rare — most data-interaction changes are captured by the data
  version instead); MINOR = new views/features; PATCH = fixes, styling, deps.
- **Source of truth:** `package.json` `version`.
- **Git tags:** `web-vMAJOR.MINOR.PATCH` (e.g. `web-v0.4.0`).
- **Changelog:** `docs/changelogs/web/vX.Y.Z.md` — audience: web-app users; can be terse. At the moment (early development) the head-commit SHA (short version) is shown in the UI, but it will be removed later (or moved into an About page).

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
- **Changelog:** `docs/changelogs/data-format/vN.md` — describes the format change,
  the migration, and why. Audience: developers and the bot. Doubles as migration
  documentation.

## How the tracks interact

Fully independent: a web release doesn't imply a Python release or a data bump, and
vice versa. The only coupling:

- **Both codebases declare the data version they require** and check the data repo
  against it on every run. Mismatch handling differs per client (below).
- **A data-version bump always ships with a migration** in the Python/skill world.
- Data changes may freely break older code — **no forward-compatibility
  guarantee**. The code that requires a new data version ships *together* with the
  migration: when a code release needs data vN, push the code tag(s) and the
  migration at the same time so the usual flow holds.

Operational consequence: migrating the data forward via `/jade` can put the **web
app into read-only until it's redeployed** to support the new data version. That's
expected — the web app auto-updates on reload, so in the normal flow the matching
web release is already live.

## No automatic code updates

We deliberately do **not** check for code updates on `/jade` invocation. The
per-interaction flow stays a data-repo pull/push only.

Rationale: the per-session skill auto-render only works when Claude is started
*from the data repo*, which isn't the intended use. The intended use is **"use
Claude however and wherever you normally do; `/jade` is there when you need it."**

Instead, the Python/skill world ships a **manual update tool** (e.g. `jadelens
update` — name TBD) the user runs when they want. It updates the installed
`jadelens` (tooling + bundled skill template) and re-renders the skill, and is
where the `data > code` abort message (below) sends them. The web app is the
exception: GitHub Pages always serves the latest build, so users get the current
version on next load (subject to cache). No opt-in flow.

## Version-mismatch handling

Automatic **data**-version checks *do* happen — on every `/jade` interaction and
every web load.

**Python / skill (`/jade`):**

| Comparison | Action |
|---|---|
| `data == code` | Normal operation. |
| `data < code` | Run the migration flow (below). |
| `data > code` | Installed code is too old (another device migrated forward). **Tell the user to run the update tool, then abort.** |

**Web app:**

| Comparison | Action |
|---|---|
| `data == required` | Normal operation. |
| `data < required` | The data needs upgrading, but the web app **does not run migrations** (for now). Show a persistent prominent warning to update the CLI and migrate via `/jade`; **disable all editing (strictly read-only)** but still **try to render** (partial is better than nothing). No "breaking vs non-breaking" distinction. |
| `data > required` | Shouldn't happen (web app is always latest on reload). If it does: reload; if that doesn't help, clear the cache and reload. |

**The usual end-to-end flow:** open the web app (auto-updates) → it detects
`data < required` → it tells the user to upgrade the CLI and run `/jade` to migrate
→ meanwhile the app is best-effort read-only → after migration `data == required`
and the app is fully functional. Works because code tags and the migration are
pushed together.

## Migrations

### Bot-run, Python-assisted

Migrations are **run by the bot**, following a **markdown runbook** bundled inside
the `jadelens` package at `jadelens/migrations/vN/RUNBOOK.md`. The runbook
interleaves two registers:

- **Natural-language instructions** for work needing intelligence — *"rename files
  so their names never include verbs," "merge duplicate research records on the
  same topic."*
- **Calls to per-migration Python helpers** for everything mechanical —
  *"`jadelens run-migration-helper <data_repo> v2/promote-sidecars`"*

Order is whatever the runbook dictates — interleaved, not "all Python then the bot
finishes up." Guiding principle: **automate in Python wherever possible to save
tokens; use the bot only where intelligence is genuinely needed.**

**Helper layout.** Each migration's helpers are Python functions in
`jadelens/migrations/vN/helpers.py`. The `jadelens run-migration-helper <data_repo>
<identifier>` subcommand dispatches to the right function via a match block (e.g.
`v2/promote-sidecars`). Helpers receive `data_repo: Path` and read any
bot-supplied input from stdin as JSON (same protocol as `apply`). They print a
structured result to stdout. No helper scripts in PATH; no subprocess spawning.

**File layout.** Each migration lives in `jadelens/migrations/vN/` containing
`RUNBOOK.md` and `helpers.py` (the latter may be minimal or empty). The
`docs/changelogs/data-format/vN.md` changelog describes the format change and
summarises how the migration works (high-level, for humans); the runbook is the
bot-executable step-by-step.

### Who runs them

- **Now:** the bot via the `/<assistant>-migrate` skill (see below), with
  `jadelens migrate` as the loop-control command. The web app detects version
  mismatches and warns only.
- **Future (bot in the web app):** the web app gains the ability to run migrations,
  turning "your data needs upgrading" into a "click to upgrade" button. The Python
  path keeps supporting terminal users.

### The `/<assistant>-migrate` skill

A dedicated rendered skill, separate from the main `/<assistant>` skill, symlinked
at `~/.claude/skills/<assistant>-migrate/`. It contains a simple loop:

1. Call `jadelens migrate <data_repo>`.
2. If the output is `DONE`, tell the user "Migration complete." and stop.
3. If the output is a runbook, follow it exactly, then go to step 1.
4. If an error occurs, report it and stop.

The skill is kept separate so the user controls when migration happens (explicit
`/<assistant>-migrate` invocation), and so migrations run in a clean context
without unrelated session history.

When `jadelens apply` detects `data < required`, it tells the user: *"Data is vN,
this CLI requires vM. Run `/<assistant>-migrate` to migrate."* No automatic
migration; the user invokes it deliberately.

### `jadelens migrate` — loop-control command

Called repeatedly by the bot inside the migration skill's loop. On each call it:

1. **Pulls** from the remote (detects anything pushed from another device; catches
   the edge case of two sessions running the same migration concurrently).
2. **Checks completion.** If `data_version == required_version`: create + push the
   end tag for the last migration (see tags below), output `DONE`, exit.
3. **Finds the open migration.** Scans tags for a `vN-v(N+1)-migration-start`
   without a corresponding `vN-v(N+1)-migration-end`. `N` equals the current
   `data_version`.
   - **No start tag (fresh start):** create + push `vN-v(N+1)-migration-start`.
   - **Start tag exists, HEAD is ahead of it (crash recovery):** commits from the
     failed attempt were never pushed — `git reset --hard <start-tag>` is safe.
     Reset, then print: *"Rolled back N commits to `vN-v(N+1)-migration-start`.
     Re-running the runbook from scratch."*
   - **Start tag exists, HEAD == start tag:** clean resume, no rollback needed.
4. **If this is not the first migration in the run:** create + push the end tag for
   the just-completed migration (`v(N-1)-vN-migration-end`) and the start tag for
   this one (`vN-v(N+1)-migration-start`) together, then push once.
5. **Output the runbook** for the `vN → v(N+1)` migration to stdout.

The bot reads the runbook and executes it. All data operations use
`jadelens apply --unsafe` (see below). The runbook's final step bumps
`.jade/version` to `v(N+1)` via `apply --unsafe`. The bot then loops back to
`jadelens migrate`.

### `jadelens apply --unsafe`

During migrations the bot must call `apply` while the data is in a transitional
state that would normally be rejected. `--unsafe` suppresses three things:

1. **Version guard** — the `data < required` check that would otherwise abort.
2. **End-of-apply rule enforcement** — the new-version invariants that the data
   doesn't yet satisfy mid-migration.
3. **Auto-push** — commits are made locally but not pushed. `jadelens migrate`
   pushes at the end of each migration (after the end tag). This makes crash
   recovery clean: uncommitted local commits can be dropped with a safe local
   `reset --hard`, with no force-push needed.

`apply --unsafe` still **pulls** before applying (to detect remote changes).
The output of any `--unsafe` call is visually distinguished (colour + emoji) so
it's unambiguous in the session transcript when the guard is bypassed.

### Tags in the data repo

Migration tags live in the data repo (not the code repo):

| Tag pattern | Example | Created when |
|---|---|---|
| `vN-v(N+1)-migration-start` | `v1-v2-migration-start` | Before the runbook for N→N+1 is output |
| `vN-v(N+1)-migration-end` | `v1-v2-migration-end` | After N→N+1 is confirmed complete (data version == N+1) |

Tags are always pushed immediately when created. The presence of a start tag with
no end tag is the signal that a migration is in progress or was interrupted.

These are **data-repo tags** — they are not code-repo release tags, and their
format doesn't conflict with `cli-vX.Y.Z` / `web-vX.Y.Z` tags.

### Execution flow

For a data repo at v2 being migrated to v5 (three sequential migrations). The
skill loop alternates between a plain call (start/resume) and a `--finalize` call
(seal the completed migration and advance):

1. User invokes `/<assistant>-migrate`.
2. Bot calls `jadelens migrate`. Creates `v2-v3-migration-start`, pushes. Outputs
   v2→v3 runbook (identifier: `v2-v3`).
3. Bot follows runbook (`apply --unsafe` for all data ops; ends with `jadelens
   check`). All migration ops are logged to `.jade/operations-log/v5.jsonl`
   (the CLI's current supported-version file).
4. Bot calls `jadelens migrate --finalize=v2-v3`. Phase A: bumps `.jade/version`
   to `v3`, commits, creates `v2-v3-migration-end`, pushes. Phase B: no end tag
   for v3-v4 yet → creates `v3-v4-migration-start`, pushes. Outputs v3→v4 runbook.
5. Bot follows runbook.
6. Bot calls `jadelens migrate --finalize=v3-v4`. Same pattern: bumps to `v4`,
   creates `v3-v4-migration-end` + `v4-v5-migration-start`, outputs v4→v5 runbook.
7. Bot follows runbook.
8. Bot calls `jadelens migrate --finalize=v4-v5`. Phase A: bumps to `v5`, creates
   `v4-v5-migration-end`, pushes. Phase B: data=v5 == required → outputs `DONE`.
9. Bot tells user "Migration complete." Skill exits.

Operations log: all operations — including migration ops — are written to the log
file matching the CLI's `__supported_data_format_version__` constant. During a
v2→v5 migration, every `apply --unsafe` call appends to `v5.jsonl`. Previous
version log files stay for history. The log file is created on first write;
`jadelens migrate` does not create it explicitly.

### One-way door

Operations-log entries from before a migration reference shapes that no longer
exist. They stay readable as history but can't be meaningfully re-applied. The
checkpoint tags are the rollback mechanism.

### Testing discipline

Before shipping a migration in a release, run it against a snapshot of pre-version
data and verify — catch breakage at release time, not at the user's startup.
Especially important because the bot executes part of it: a migration that worked
yesterday may behave differently as models/prompts drift.

## Changelog layout

```
docs/changelogs/
  cli/          vX.Y.Z.md   (skill + tooling; audience: /jade users)
  web/          vX.Y.Z.md   (UI + app; audience: web users; may be terse)
  data-format/  vN.md       (data format + migration doc; audience: devs + the bot)
```

Per-track directories, one file per version — keeps changelogs focused instead of
a monolithic CHANGELOG mixing unrelated changes. This replaced the original flat
changelog, now split into the per-track layout (`cli/v0.1.0.md`, `web/v0.1.0.md`,
`data-format/v1.md`).

## Git tags

**Code repo tags** (in `tomasssalles/jade-lens`):

| Tag | Example | Meaning |
|---|---|---|
| `cli-vMAJOR.MINOR.PATCH` | `cli-v1.2.3` | Python tooling/skill release |
| `web-vMAJOR.MINOR.PATCH` | `web-v0.4.0` | Web app deployment |

Tags are created at the version-bump commit (for the web app, the commit that
triggers the Pages deploy). When a code release requires a new data version, push
the code tag(s) **and** the migration together.

**Data repo tags** (in the user's private data repo):

| Tag | Example | Meaning |
|---|---|---|
| `vN-v(N+1)-migration-start` | `v1-v2-migration-start` | Checkpoint before a migration; rollback point |
| `vN-v(N+1)-migration-end` | `v1-v2-migration-end` | Migration confirmed complete |

See the Migrations section for how these tags are used.

## Summary

| Aspect | Python tooling/skill | Web app | Data format |
|---|---|---|---|
| Format | semver | semver | sequential integer |
| Source of truth | Python `__version__` | `package.json` | `.jade/version` |
| Git tags | `cli-vX.Y.Z` | `web-vX.Y.Z` | none |
| Changelog | `docs/changelogs/cli/` | `docs/changelogs/web/` | `docs/changelogs/data-format/` |
| Update | manual update tool | page reload (always latest) | migration |
| On `data < code` | run migration | warn + read-only, point to `/jade` | — |
| On `data > code` | tell user to update, abort | reload (then clear cache) | — |
| Migration runner | bot via `/<name>-migrate` skill + `jadelens migrate` | detects + warns only (for now) | — |
