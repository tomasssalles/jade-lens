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
- [Release version decision](#release-version-decision)
- [Versioning and version comparison](#versioning-and-version-comparison)
- [Self-update of code and skill](#self-update-of-code-and-skill)
- [Data migration framework](#data-migration-framework)
- [Schema and view registry](#schema-and-view-registry)
- [Structured-creation forms](#structured-creation-forms)
- [Calendar integration](#calendar-integration)
- [Text and markdown editor](#text-and-markdown-editor)
- [File move, rename, and delete](#file-move-rename-and-delete)
- [JSON value editors](#json-value-editors)
- [Raw JSON structural editor](#raw-json-structural-editor)

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

## Release version decision

**Scope:** cross-cutting / housekeeping.

Phases 1–4 (web editing, sync, stash, /jade auto-sync) shipped behavior beyond
what `changelogs/v0.1.0.md` scopes ("no web app", "manual syncing"). Decide
whether to expand the v0.1.0 changelog or cut `changelogs/v0.2.0.md` and bump
`.jade/version`. A decision plus a changelog write.

**Blockers:** none.

**Open questions:**
- Expand v0.1.0 vs. new v0.2.0? A version bump touches the (still unbuilt)
  migration story, so coordinate with the versioning items.

---

## Versioning and version comparison

**Scope:** pipeline + web + /jade.

Embed a code version in both clients; the data repo carries `.jade/version`; on
load, compare data-vs-code → `data>code` refuse / `data==code` run / `data<code`
migrate (DESIGN §14.1, §14.4). Foundational for safe releases. DESIGN §15.1
expected this in v1 "with the framework in place" — it wasn't built, so this
closes that gap.

**Blockers:** Release version decision (need the starting version).

**Open questions:**
- How the web build exposes its version (the §14.3 `<meta>` + bundled constant);
  how /jade derives its code version (installed `jadelens` package version).

---

## Self-update of code and skill

**Scope:** web + /jade.

Code makes itself current *before* any data work (DESIGN §14.3). Web: compare the
`<meta app-version>` against the bundled JS constant, cache-bust on mismatch
(works around GitHub Pages caching). Skill: it already re-renders from the bundled
template each session; make sure that reliably tracks the installed `jadelens`
version.

**Blockers:** Versioning and version comparison.

**Open questions:**
- Service-Worker handling if we ship one; exact cache-bust mechanics on GitHub
  Pages.

---

## Data migration framework

**Scope:** pipeline + /jade (bot-executed) + web (flow + UI).

`migrations/<target>.md` scripts (natural-language instructions + Python helpers),
and the migration flow: checkpoint tag → collect scripts in range → dry-run
summary → apply → bump version → start a fresh ops-log (DESIGN §14.2, §14.5–14.8).
Plus the one-way-door messaging and interrupted-migration reset-and-retry. The
mechanism that lets the data shape evolve safely as the design crystallizes.

**Blockers:** Versioning and version comparison; Self-update of code and skill.
(Inline-vs-sidecar promotion, if shipped, gives a low-stakes first migration:
retroactively promote existing oversized inline strings.)

**Open questions:**
- Migration testing discipline at release time; whether to pin the model version
  used during a migration run (§14.8).

---

## Schema and view registry

**Scope:** pipeline + web.

The DESIGN §4.9 registry: a registered type carries both a data **schema**
(runtime-enforced) and a UI **view**. The bot annotates a file via the index
(`view:`); the runtime honors it from a fixed registry (§9.4). Foundational — it
quietly blocks several downstream features. Large; the design needs fleshing out
before building.

Unlocks: structured-creation forms, the calendar grid + typed event records, and
the "typed numeric field → thousands grouping" idea we parked during number
editing.

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

Phase 5g remainder. Boolean and number are done (the edit-mode lock + per-field
pencil + picker/type-in field). Remaining effective types:
- **date / time** → native picker.
- **wikilink** (`[[path]]`) → file picker.
- **plain string** → opens the text editor on that field.

Each is one `json_patch` `replace` behind the same pencil.

**Blockers:** date and wikilink — none. Plain-string editing leans on the Text and
markdown editor item; and once strings can grow via the UI, the optimistic apply
must go through the real pipeline so Inline-vs-sidecar promotion shows up
immediately (wikilink + new file).

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
