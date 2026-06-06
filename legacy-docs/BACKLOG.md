# JADE LENS — backlog

A working to-do list and a place to think out loud about *how* we'll build each
thing. Conventions:

- **One H2 section per work item. No numbers** — so inserting an item in the
  middle never forces a renumber. The Contents list below links to each.
- **No status field.** When an item is finished, just delete its section (and its
  Contents line).
- **Every item has a `Blockers` line** so the build order is clear. "none" means
  it can be picked up now.
- `Scope` is a loose tag (pipeline / web / /jade / cross-cutting), not a category
  hierarchy.

This is a to-do list, not JIRA. Keep it light.

## Contents

- [Inline-vs-sidecar promotion](#inline-vs-sidecar-promotion)
- [Seed version tracks and changelog layout](#seed-version-tracks-and-changelog-layout)
- [Re-organize all docs](#re-organize-all-docs)
- [Versioning and version comparison](#versioning-and-version-comparison)
- [Update tool](#update-tool)
- [Data migration framework](#data-migration-framework)
- [Schema and view registry](#schema-and-view-registry)
- [Structured-creation forms](#structured-creation-forms)
- [Calendar integration](#calendar-integration)
- [Text and markdown editor](#text-and-markdown-editor)
- [File move, rename, and delete](#file-move-rename-and-delete)
- [JSON value editors](#json-value-editors)
- [Date/time localization and travel behavior](#datetime-localization-and-travel-behavior)
- [Raw JSON structural editor](#raw-json-structural-editor)
- [Create file](#create-file)
- [Index-driven navigation](#index-driven-navigation)
- [Search and filter](#search-and-filter)
- [Data-repo bootstrap](#data-repo-bootstrap)
- [Codex compatibility](#codex-compatibility)
- [Credential storage and trust](#credential-storage-and-trust)
- [Bot in the web app](#bot-in-the-web-app)

---

## Inline-vs-sidecar promotion

**Scope:** pipeline (web + /jade).

Runtime auto-migrates an inline JSON string into a `.md` sidecar + a wikilink when
it grows (≥3 lines, or markdown-structured), per DESIGN §4.4. Lives in the shared
mutation pipeline (`jadelens/` + `web/src/mutation/`), so it must be
byte-identical across clients and needs new `conformance/cases/`. Reuses the
existing wikilink post-pass for references. Forward-only (hysteresis: a sidecar
that shrinks stays a file). Auto-promoted sidecars are **not** indexed; the manual
`create_file` path stays for content that deserves a primary-file slot.

Good first build for the cloud env — pure logic, fully conformance-testable, no
browser. Also sets up a natural first migration (retroactively promoting existing
oversized inline strings — see Data migration framework).

**Blockers:** none — but lock the design first (open questions below).

**Open questions:**
- Filename convention (§4.5): confirm the sidecar-directory shape
  (`projects/leasing.json` → `projects/leasing/<key>.md`); how nested key-paths
  and name collisions map.
- Exact triggers, precise enough for byte-parity: the "≥3 lines" counting rule;
  the markdown-marker set (headings / list bullets / fenced code / multi-paragraph)
  as concrete regexes.
- Scope guards: only inline strings via `json_patch` add/replace; never re-promote
  a value that's already a wikilink; unified diffs to existing `.md` pass through.

---

## Seed version tracks and changelog layout

**Scope:** cross-cutting / housekeeping.

Adopt the three-track versioning system (`docs/versioning.md`): set the initial
Python-tooling and web-app semver versions, set `.jade/version` to an integer, and
split the current flat `changelogs/v0.1.0.md` into the per-track layout
(`changelogs/{python,web,data}/`). This supersedes the old "expand v0.1.0 vs. cut
v0.2.0" question — with three independent tracks there's no single "the version" to
bump. Phases 1–4 already shipped behavior beyond what the flat v0.1.0 changelog
scopes, so the split also reconciles the record with reality.

**Blockers:** none. (Mostly a docs/changelog reorganization; the live version
*checks* are the Versioning item.)

**Open questions:**
- Starting numbers for each track (py/web semver; data `1`).
- How to map the existing `changelogs/v0.1.0.md` content across the three tracks.

---

## Re-organize all docs

**Scope:** cross-cutting / housekeeping.

Take stock of all the project documentation, decide how it should be organized, and
improve it. The docs have grown organically — `CLAUDE.md`, `DESIGN.md` (large, and
explicitly vision-not-current-state), the changelog, `KNOWN_ISSUES.md`, this
`BACKLOG.md`, `docs/mutation-sync-implementation-plan.md`, the per-feature docs
under `docs/` and `docs/web/`, the conformance READMEs, and the two app READMEs —
and some now overlap or drift.

**Blockers:** none.

**Open questions:**
- BACKLOG vs. `docs/mutation-sync-implementation-plan.md`: forward-looking work now
  lives in both. Does BACKLOG own "what's next" while the plan becomes a historical
  record of the mutation/sync build (kept or archived)?
- The plan's §8 checklist is partly stale (the lock/pencil work superseded the 5g
  boolean-gesture notes; number editing isn't recorded) — reconcile or retire it.
- `DESIGN.md` is large and vision-not-reality. Split (vision vs. reference)?
  Annotate what's built vs. planned? Leave as-is?
- Does `docs/` need an index/README so the docs are discoverable?
- Naming and placement conventions for future per-feature docs.

---

## Versioning and version comparison

**Scope:** pipeline + web + /jade.

Implement the three version tracks and the automatic **data**-version checks per
`docs/versioning.md`: py/web semver (tags `py-`/`web-`; `package.json` + Python
`__version__`; web version shown in the UI), data version as an integer in
`.jade/version` that **both** codebases check against on every run. Mismatch
handling: `data < code` → migrate (/jade) or warn + read-only (web); `data > code`
→ tell the user to update and abort (/jade) / reload then clear-cache (web).
Foundational for safe releases.

**Blockers:** Seed version tracks and changelog layout (need the starting points).

**Open questions:**
- Where the web build reads its version from; how /jade derives its code version
  (installed `jadelens` package version) and stamps the skill's version marker.

---

## Update tool

**Scope:** /jade (CLI tooling).

A **manual** update tool (e.g. `jadelens update` — name TBD) that updates the
installed `jadelens` (tooling + bundled skill template) and re-renders the skill.
We deliberately do **not** auto-check for code updates on skill invocation — the
per-interaction flow stays a data pull/push only (`docs/versioning.md`, "No
automatic code updates"). The user runs this when they want; it's also where the
`data > code` abort message sends them. (The web app needs no equivalent — it's
always the latest build on reload.)

**Blockers:** Versioning and version comparison (its main trigger is the
data-version check telling the user to update).

**Open questions:**
- Command name; whether it surfaces a changelog of what changed.

---

## Data migration framework

**Scope:** /jade (bot-run, Python-assisted) + web (detect/warn now; run later).

Bot-run migrations following a markdown runbook for the target data version that
interleaves natural-language steps with calls to per-migration Python helper
scripts (automate in Python wherever possible to save tokens). Keep the safety net
(`docs/versioning.md`): pre-check → checkpoint tag → dry-run confirm → per-migration
atomic apply + version bump + ops-log entry + commit → push → fresh ops-log;
reset-to-checkpoint-and-retry on interruption (migrations needn't be idempotent);
one-way-door messaging. Web detects + warns + read-only for now; gains the ability
to run migrations in the bot-in-web-app phase.

**Blockers:** Versioning and version comparison. (Inline-vs-sidecar promotion, if
shipped, gives a low-stakes first migration: retroactively promote existing
oversized inline strings.)

**Open questions:**
- Exact migration file layout (`migrations/vN.md` runbook + `migrations/vN*.py`
  helpers vs. a `migrations/vN/` dir) and its relation to `changelogs/data/vN.md` —
  settle at implementation.
- Release-time migration testing; whether to pin the model version used in a run.

---

## Schema and view registry

**Scope:** pipeline + web.

The DESIGN §4.9 registry: a registered type carries both a data **schema**
(runtime-enforced) and a UI **view**. The bot annotates a file via the index
(`view:`); the runtime honors it from a fixed registry (§9.4). Foundational — it
quietly blocks several downstream features. Large; the design needs fleshing out
before building.

Unlocks: structured-creation forms, the promoted-view renderers (table / kanban /
timeline / calendar grid), typed event records, and the "typed numeric field →
thousands grouping" idea we parked during number editing.

**Blockers:** none.

**Open questions:**
- Initial registered types (calendar event, task?); how schemas are declared and
  enforced; how the registry wires into the card viewer's rendering.

---

## Structured-creation forms

**Scope:** web.

The third mutation tier (DESIGN §9.2, Phase 5): a schema-backed form that commits
a whole record on submit. With all data currently freeform, there's nothing to
put in a form yet.

**Blockers:** Schema and view registry.

---

## Calendar integration

**Scope:** /jade + web (+ external adapters later).

Phased (DESIGN §10.5):
- **v1 — manual import:** paste calendar info into chat; the bot creates
  augmentation records + lightweight "shadow" records (title/date/attendees) for
  offline reasoning. No API. Mostly SKILL.md conventions + data shape.
- **Later:** read API (Google Calendar / CalDAV), then write, then the embedded
  `view:"calendar"` grid with bidirectional deep links.

**Blockers:** structured event records + the grid need Schema and view registry;
the API phases need calendar adapters. A *freeform* manual-import first cut has no
hard blocker.

**Open questions:**
- Do a freeform manual-import cut now, or wait for the schema so events are typed
  from the start?

---

## Text and markdown editor

**Scope:** web.

Phase 5c. A raw CodeMirror source editor first (WYSIWYG/tiptap later, keeping raw
as the source-mode alternative), plus the edit-mode state machine,
save-on-(button | in-app nav), cancel, in-app-nav-vs-app-switch detection, and
draft writes on background / interval / unload. Groundwork (the 0-context diff
generator, the draft store + startup reconciliation) is already in place.

**Blockers:** none. (Adds a dependency, lands on the auto-deploying `claude-ai`
branch, and the repo has no component-test infra — wants a real browser to verify.)

---

## File move, rename, and delete

**Scope:** web.

Phase 5e/5f. FileBrowser affordances → confirm → commit. `rename_path`
auto-rewrites every wikilink to the moved path; `delete_path` is rejected if any
wikilink still points at the target, and the message names the referrers (no
auto-removal). The builder logic (`web/src/edit/fileOps.js`) is done.

**Blockers:** none. (Needs a browser to verify.)

---

## JSON value editors

**Scope:** web.

Phase 5g remainder. Boolean, number, **date/datetime**, and **wikilink** are done
(the edit-mode lock + per-field pencil + picker/type-in field; `web/src/edit/
valueType.js` classifies a string leaf and the editors live in `JsonCardViewer`).
Remaining effective types:
- **time-only** (`HH:mm[:ss]`, naive or zoned) → native time picker. Not done:
  neither the display plugin (`remarkDates`) nor `classifyStringValue` matches a
  bare time yet, so it currently renders/edits as a plain string. Adding it means
  extending both, plus a `<input type="time">` editor.
- **plain string** → opens the text editor on that field.

Each is one `json_patch` `replace` behind the same pencil.

Date/datetime model (settled, implemented): storage is never rewritten; values
are displayed in **their own** zone (naive = local), never converted, with a small
`UTC` / `±hh:mm` suffix on zoned values that aren't in the viewer's current local
offset; the editor shows that same wall-clock and keeps the zone. See "Date/time
localization and travel behavior" for the open follow-ups.

**Blockers:** time-only — none. Plain-string editing leans on the Text and
markdown editor item; and once strings can grow via the UI, the optimistic apply
must go through the real pipeline so Inline-vs-sidecar promotion shows up
immediately (wikilink + new file).

---

## Date/time localization and travel behavior

**Scope:** web (display) + cross-cutting (conventions).

The current model never converts a stored datetime and shows it in its own zone
(see "JSON value editors"). That's the right default, but a few questions are
deliberately deferred:

- **How do we decide what's "local"?** Today "local" means "the value's offset
  equals the browser's current offset," which is what gates the zone suffix. Is
  that the right notion? Naive values are assumed local by interpretation — do we
  ever want to attach a real zone to them (e.g. on edit)?
- **Travel behavior.** When the user is in a different timezone than usual, the
  browser's offset changes, so the same value can flip between "looks local, no
  suffix" and "shows a suffix" depending on where they are. Is that desirable, or
  should "home/usual zone" be a stored preference independent of the device?
- **Opt-in localization.** Some values (UTC log-style timestamps) *would* be nicer
  converted to local — the grafana mood. Since nothing in the data distinguishes
  "a UTC instant I want localized" from "an event genuinely in UTC," this can only
  be a user-chosen view toggle layered on the never-convert default, not an
  inferred behavior. Decide if/when to add it.

**Blockers:** none — design discussion, then a small display/setting change.

---

## Raw JSON structural editor

**Scope:** web.

Phase 5h. The escape hatch for arrays / type changes / key add-remove-move: edit
the whole file as syntax-highlighted text, parse + validate on save (keep the
editor open with a helpful error on failure), and derive a `json_patch` via the
structural diff generator (`web/src/edit/jsonPatchGenerate.js`, already built and
fuzz-pinned).

**Blockers:** none. (Needs a browser; shares CodeMirror with the Text and markdown
editor.)

---

## Create file

**Scope:** web.

UI to create a new `.md` or `.json` file via the `create_file` op (path must end in
an editable suffix; missing parent dirs are `mkdir -p`'d; `.json` content is
parse-validated at create time). Pick a path/name and type, open the matching
editor for initial content (the markdown editor for `.md`, the raw-JSON editor for
`.json`), save → one `create_file` batch. Likely a "+" affordance in the
FileBrowser.

**Blockers:** Text and markdown editor; Raw JSON structural editor — a new file is
created by opening an editor on it.

**Open questions:**
- Where the "new file" affordance lives (FileBrowser "+", or from a folder); how
  the path/name and type get chosen.
- Whether a new `.json` opens in the raw editor or as an empty card; whether to
  offer adding an index entry (primary file) vs. leaving it unindexed.

---

## Index-driven navigation

**Scope:** web.

Use `Index.json` as the UI's table of contents (DESIGN §9.3): primary files grouped
by the index's groupings, records expandable, sidecar wikilinks followable —
instead of the current raw file tree, which won't scale as the data grows. The bot
maintains the index; the UI just reads it.

**Blockers:** none. (The index already exists as data; this is UI. Needs a browser
to verify.)

**Open questions:**
- Replace the raw file tree, or offer both (index view + a "show all files"
  fallback)?
- How orphan files (present but not in the index) are surfaced.
- Confirm how groupings/ordering are expressed in `Index.json` (§4.6) and how much
  the UI should infer.

---

## Search and filter

**Scope:** web.

Find files and records without walking the tree (DESIGN §9.3, §9.5) — "covers the
cases where navigation isn't fast enough." Client-side over `workingMap` (the
content authority), likely spanning filenames, content, and index descriptions.

**Blockers:** none. (Needs a browser to verify.)

**Open questions:**
- Search scope: filenames only, full content, index descriptions/tags?
- Presentation: filter the navigation in place, or a separate results list?
- Substring vs. fuzzy matching.

---

## Data-repo bootstrap

**Scope:** /jade (CLI tooling).

A `jadelens init <data-repo>` console command that scaffolds the bootstrap files
that are manual today (`changelogs/v0.1.0.md` parks this; see
`docs/data-repo-setup.md`): `.jade/config.json`, `Index.json`, `.gitignore`,
`.claude/settings.json`, `.claude/hooks/session-start`. Removes hand-assembly so
onboarding isn't error-prone — worth having before the app reaches more people (or
the bot).

**Blockers:** none.

**Open questions:**
- Interactive prompts (user names, assistant name, repo URL) vs. flags.
- Whether it also `git init`s and makes the first commit.
- Idempotency: refuse / merge when run on a dir that already has `.jade/`.

---

## Codex compatibility

**Scope:** /jade (docs + testing).

Test whether Codex can act as a JADE LENS assistant using the same skill file that
Claude Code uses. The likely path: add a global Codex config entry (at
`~/.codex/config.yaml` or equivalent) pointing at
`<data-repo>/.claude/skills/<assistant-name>/SKILL.md` — the same rendered file the
Claude Code skill loads. If Codex can read and follow the runbook, the tooling is
already vendor-neutral (it is: `jadelens-apply` takes no stance on the calling bot)
and no code changes are needed. The task is to: (1) find the correct Codex
config knob, (2) test a few representative /jade interactions, (3) note any
behavioral gaps, (4) if it works well enough, document the setup for users.

**Blockers:** none (exploration only; no code changes expected).

**Open questions:**
- Exact Codex config file location and schema for registering a custom skill/agent.
- Whether Codex's instruction-following is close enough to Claude Code's that the
  skill prose needs no adaptation, or whether a separate render target is warranted.

---

## Credential storage and trust

**Scope:** cross-cutting (web).

Current stance (DESIGN §16.2): plaintext PAT in browser storage + a visible
warning, single-user assumption. The bot-in-web-app phase adds a *second* secret
(the Anthropic API key), which raises the stakes. Track the hardening options:
isolated-origin hosting (§16.3), PAT/key encryption once the origin is isolated
(§16.4), re-auth for settings changes (§16.5), recovery via PAT rotation (§16.6).

Mostly deferred — a visible stub so it can be pulled forward when the second secret
actually lands.

**Blockers:** none for the stub. Some options (encryption) are gated on
isolated-origin hosting (§16.3), itself a decision.

**Open questions:**
- Which hardening to do *when* the bot key arrives.
- Whether to move to an isolated origin / self-hosting escape hatch (§16.3, §16.7).

---

## Bot in the web app

**Scope:** web (+ bot adapters, cost ledger). **Big — the final phase.**

The chat UI in the web app driving the bot via the Claude API (or a Claude Code
subprocess on desktop, §15.2), with the runtime assembling context (the discovery
flow, §6), the cost ledger (§13), vendor/model/key settings (§11.3, §16), and bot
mutations routed through the same pipeline as UI edits (§9.2, §12.1). This will
spawn many smaller backlog items; break it down as we approach — no need to
enumerate them now.

**Blockers:** the web app should first be a complete standalone manual data manager
(the editing / create / move-delete / navigation / search items) and the
foundational tracks should land (Versioning and version comparison; Data migration
framework; Schema and view registry). Many sub-tasks TBD.

**Open questions:**
- API transport vs. Claude-Code-subprocess transport (§15.2) — and whether they
  coexist (mobile vs. desktop).
- How much of the discovery flow to start with (eager-load-everything vs. the
  structured data-request flow, §6.3).
