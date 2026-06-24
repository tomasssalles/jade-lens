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

- [Sidecar integrity check scope](#sidecar-integrity-check-scope)
- [Wikilink pass consolidation](#wikilink-pass-consolidation)
- [Sidecar inline accordion expansion](#sidecar-inline-accordion-expansion)
- [Automation visibility in apply output and log](#automation-visibility-in-apply-output-and-log)
- [Fail-safe handling of an unparseable data-format version](#fail-safe-handling-of-an-unparseable-data-format-version)
- [Re-organize all docs](#re-organize-all-docs)
- [Schema and view registry](#schema-and-view-registry)
- [Structured-creation forms](#structured-creation-forms)
- [Calendar integration](#calendar-integration)
- [Text and markdown editor](#text-and-markdown-editor)
- [File move, rename, and delete](#file-move-rename-and-delete)
- [JSON value editors](#json-value-editors)
- [Date/time localization and travel behavior](#datetime-localization-and-travel-behavior)
- [Raw JSON structural editor](#raw-json-structural-editor)
- [Create file](#create-file)
- [Search and filter](#search-and-filter)
- [Onboarding an existing data repo on a new device](#onboarding-an-existing-data-repo-on-a-new-device)
- [Codex compatibility](#codex-compatibility)
- [Credential storage and trust](#credential-storage-and-trust)
- [Bot in the web app](#bot-in-the-web-app)

---

## Sidecar integrity check scope

**Scope:** pipeline (Python + JS).

The end-of-apply enforcement pass (`run_enforcement_pass`) currently runs sidecar
structural checks (5f) over every JSON file in the repo, even when only one file
was touched by the batch. For large repos this adds unnecessary work.

Optimization: limit the integrity scan to the subset of JSON files actually
affected by the current batch (i.e., files that were created, modified, or whose
sidecars could have been touched).

**Blockers:** none.

---

## Wikilink pass consolidation

**Scope:** pipeline (Python + JS).

Multiple wikilink passes run over the entire repo during a single `apply`. For example,
2 file moves + 1 delete currently triggers 4 full passes: 2 reference rewrites (for
the moves), 1 dangling-reference check (for the delete), and 1 wikilink integrity
scan (4e). The integrity scan already covers the deletion case, so that's 3 instead
of 4 — but we could reduce to a single pass.

A single-pass approach: collect a `{wikilink_target: [occurrences]}` index over the
whole repo once, where each occurrence carries its location (file path + line number
for markdown, or file path + JSON pointer for JSON). With this index we can
efficiently rewrite wikilinks to moved files and check the integrity of all others.

Edge cases to handle carefully: a single line in a markdown file may contain two
wikilinks to moved files; the stored occurrence info must capture position (not the
current line value) so rewrites compose correctly.

This same collected index could also accelerate the sidecar invariant check that
wikilinks into `.sidecars/` appear only at their owner field (5f-iv).

**Blockers:** none.

---

## Sidecar inline accordion expansion

**Scope:** web.

In the JSON card view, sidecar values are currently shown as a truncated one-line
preview with a ↗ icon to navigate to the full sidecar view. An accordion expansion
would let the user read and scroll the full sidecar content inline, without leaving
the card.

**Blockers:** none (but shares concerns with the text editor item — editing inside
an accordion adds complexity).

---

## Automation visibility in apply output and log

**Scope:** pipeline (Python + JS).

Currently, post-apply passes (wikilink rewrites on `rename_path`, index-entry
appending on `create_file` with `indexed: true`, and any future automations) are
invisible: they don't appear in the `jadelens apply` output and aren't recorded in
the operations log. Only the bot's original operations appear in both places.

The situation is also inconsistent: sidecar promotions (5e) *are* reported in the
apply output, while the other automations above are not. So the current state is
partially transparent — worse in some ways than full opacity, because it's hard to
reason about which automations are visible and which aren't.

This is a transparency gap in both directions:

- **For the bot**: the apply reflection is what it sees as the result of its call.
  If `Index.json` was written or a wikilink was rewritten, the bot doesn't know
  unless it re-reads the file. This could lead to stale assumptions in subsequent
  interactions.
- **For the human**: reading the log to understand how the data got to its current
  state, automation effects are invisible — their cause is the code version, not
  the log entry. This is exactly the version-dependency we want to avoid.

The right fix is probably to surface automation effects in both places, but with an
unambiguous visual distinction from bot-issued operations — e.g. a `[runtime]`
prefix or a separate "Automations:" section in the output. The log is harder:
recording automations in it means the log entries are no longer a pure replay of
bot ops. One option is a separate `automations` field alongside `operations` in
each log entry, so the two are always distinguishable.

**Blockers:** none. But settle the design before building — the log schema change
is permanent.

**Open questions:**
- Should automation effects appear in the apply output, the log, or both?
- Log schema: a top-level `automations` field per entry (records `{type, ...}` for
  each runtime action), or a separate log file, or something else?
- Exact output format: prefix, section, or interspersed after the triggering op?
- Do we want the bot to see automations in its reflection, or is it better for the
  bot to re-query state when it needs to know? (Contrast: the wikilink rewrite is
  unlikely to affect a subsequent op in the same session; the index append might
  matter if the bot queries the index soon after.)

---

## Fail-safe handling of an unparseable data-format version

**Scope:** pipeline (Python + JS) + web.

`.jade/version` is parsed as a sequential integer with an optional `v` prefix
(`read_text().strip().lstrip("v")` → `int(...)`). When the file is **present but
unparseable** (e.g. an old semver-style `v0.1.0` from a repo predating the
sequential-integer scheme), the `ValueError` is swallowed in a way that *disables*
the safety check rather than flagging it — the opposite of fail-safe:

- **Apply** (`workflow._check_data_format_version`) does `except ValueError:
  return`, conflating "unparseable" with "absent → skip check". So `jadelens apply`
  sails past the migration guard as if the data already matched the supported
  version, then trips the end-of-apply v2 enforcement pass — surfacing confusing
  *rule-violation* errors instead of "you need to migrate."
- **Migrate** (`migrate._read_data_version`) returns `None`, which `do_migrate`
  turns into `sys.exit("Cannot read .jade/version. Is this a valid JADE LENS data
  repo?")` — so the one tool that should rescue an old repo refuses with a
  misleading "is this even a valid repo?" message.

Fix: distinguish **present-but-unparseable** from **absent**. Absent legitimately
skips the check (version unknown). Present-but-unparseable should be a hard,
explicit error that points the user at the migration flow (and, for a recognizably
old semver value, ideally says "this looks like a pre-v1 repo; set `.jade/version`
to `v1` and run `/<assistant>-migrate`"). Mirror the same handling in the JS
pipeline and the web app's version check (9d) so all three clients agree.

**Blockers:** none.

**Open questions:**
- Do we auto-heal an obvious legacy `v0.1.0` → `v1` (with confirmation), or only
  instruct the user? Auto-healing touches `.jade/`, which `apply` won't do, so it
  would belong to the migration tooling, not `apply`.

---

## Re-organize all docs

**Scope:** cross-cutting / housekeeping.

Mostly **done**: the monolithic `DESIGN.md` is split into focused docs under
`docs/design/`, the changelogs are per-track, and `BACKLOG.md`/`KNOWN_ISSUES.md`
moved to `docs/planning/`. `legacy-docs/` is retired.

Residual cleanup left:
- Some relocated detail docs (`docs/design/web/*`, `docs/design/sync-mechanism.md`,
  `conformance/README.md`) still carry prose `DESIGN §N` cross-references pointing
  at the deleted monolith — repoint them at the relevant `docs/design/` files.

**Blockers:** none.

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

## Onboarding an existing data repo on a new device

**Scope:** /jade (CLI tooling + docs).

`jadelens init` bootstraps a **brand-new, empty** data repo. The other case is
getting `/jade` working on a **new device** against a data repo that's **already
been initialized** (has `.jade/`, the hook, a rendered-skill `.gitignore`, etc.).
The session-start hook already handles most of it once the repo is cloned and a
`claude` session is started from it (installs `jadelens`, renders the skill,
symlinks `~/.claude/skills/<name>/`), so this may just need **documenting a
how-to** (clone the repo; start `claude` from it once; done). Decide whether to
leave it as docs, add it to `jadelens init` behind a flag (e.g. `--existing` /
`jadelens setup <clone>`), or have `init` **auto-detect** an already-bootstrapped
clone and run only the install/render/symlink steps. See
`docs/design/claude-code-integration.md`.

**Blockers:** none.

**Open questions:**
- How-to only, an `init` flag, or auto-detection?
- Does the user clone the repo themselves, or do we offer to clone (like `init`)?
- Anything device-specific to set beyond the skill symlink?

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
