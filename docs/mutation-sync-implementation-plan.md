# Implementation Plan — Data Mutation, Sync & Conflicts

> **Audience: a fresh session told "implement everything" (or "resume").** This
> document is the entry point. Read §0 first, then work the phases in order,
> checking off and committing the progress list in §8 as you go. Nothing in here
> is built yet — the design is finalized (see §1 for doc pointers); this is the
> build order.

---

## 0. How to use this document

1. **Catch up first.** Read `CLAUDE.md`, then the design docs in §1. Then skim
   the current code in §2 so you know what already exists.
2. **Work phases in order** (§3–§4). Each phase has a *definition of done*, the
   *files* it touches, *how* to approach it, *doc pointers*, and *verification*.
   Don't start a phase before its dependencies are green.
3. **Track progress in §8.** Tick boxes and commit the doc as you complete steps,
   so the next session sees exactly where things stand. The checklist is the
   resume pointer.
4. **Branch policy.** In the claude.ai cloud environment, always develop on the
   `claude-ai` branch (per `CLAUDE.md`). Locally, use the checked-out branch.
5. **Verification is mandatory per phase.** Python: `uv run pytest`. Web (from
   `web/`): `npm run lint`, `npm test`, `npm run build`. Never mark a phase done
   on red.
6. **Do NOT build the §5 deferred items.** They're intentionally out of scope;
   building them now is scope creep.

---

## 1. What we're building & where the design lives

User-driven data edits in the **web app**, plus **sync** of the data repo
between devices and **conflict resolution** via a stash — across both clients
(web app and the `/jade` Claude Code skill). The mutation pipeline is shared in
spirit (one op model, byte-identical output), validated by the conformance suite.

**Design docs (read these; this plan only summarizes):**

| Topic | Doc |
|---|---|
| Mutation tiers, edit-mode UX, drafts, UI commit messages | `docs/web/editing.md` |
| Sync, conflict detection, the stash (both clients), known atomicity edge | `docs/sync-and-conflicts.md` |
| Canonical decisions in context | `DESIGN.md` §4.2 (ops), §7.2–7.3 (log, commit msg), §8 (sync/substrate/conflict), §9.2 (UI edits feed same pipeline), §12.1–12.2 (shared pipeline + `/jade` tool) |
| Cross-client mutation contract + runner contract | `conformance/README.md` (esp. §3 schema, §4 "what a runner must do", §5 error codes) |
| Conformance gap audit + serialization edge cases | `conformance/PENDING_WORK.md` |

---

## 2. Current state (what exists today)

- **Python mutation pipeline** — `jadelens/operations.py` (the 5 typed ops +
  validation + JS-canonical JSON serialization `dumps_js_canonical`),
  `jadelens/workflow.py` (`run`: clean-tree check → apply batch atomically →
  wikilink post-pass → append ops-log line → git commit; reverts on failure),
  `jadelens/unified_diff.py` (diff parse/apply). Real git is the substrate here.
- **Conformance suite** — `conformance/cases/*.json` (**62 cases**),
  `conformance/runners/python/` (pytest). **Python runner only; the JS runner
  does not exist yet** (called out as future work in `PENDING_WORK.md`).
- **Web app** — `web/`, a **read-only** React+Vite SPA. Reads a GitHub repo via
  the REST API (`web/src/github.js`), caches in IndexedDB (`web/src/db.js`,
  `web/src/repoCache.js`), renders JSON cards (`JsonCardViewer.jsx`) and markdown
  (`MarkdownRenderer.jsx` + remark plugins in `web/src/plugins/`). No write, no
  mutation, no conflict-aware sync.
- **`/jade` skill** — Python tooling + a bundled SKILL.md template
  (`jadelens/templates/skill/`). Currently **manual** pull/push; SKILL.md does
  not yet say sync is automatic.

**Implication:** the JS mutation pipeline is the missing foundation. Almost
everything below depends on it.

---

## 3. Phase overview & dependency order

```
Phase 0  JS mutation pipeline + JS conformance runner   ← foundation, pure logic
   │
   ├── Phase 1  Web: operation-queue + GitHub commit substrate
   │      │
   │      └── Phase 2  Web: sync-on-focus + conflict detection + stash
   │             │
   │             └── Phase 3  Web: checkbox toggle (first real edit)  ← MVP slice
   │
   └── Phase 4  /jade: auto-sync + stash + tooling cmds + SKILL.md   (parallel after P0)

Phase 5  Web: grow editing (text/session, forms, drafts)            (after P3)
Phase 6  Cross-client stash/sync conformance                         (future, after P4)
```

The **MVP vertical slice** the product owner asked for is **Phases 0→1→2→3**:
checkbox toggling in the web app, on top of full sync + conflict + stash. Phase 4
brings `/jade` into the same synced/stash world and can proceed in parallel once
Phase 0 lands. Phases 5–6 are growth.

> **One ordering decision to confirm with the owner if unsure:** Phase 0 builds
> the **full** JS pipeline (all 5 ops) to get the whole conformance suite green —
> the cleanest, most testable foundation. The checkbox MVP technically only needs
> the `unified_diff` path. Building the full pipeline front-loads the hard
> byte-parity work behind the existing 62-case safety net and is recommended;
> trimming it would leave the JS conformance runner partial. Default: build it
> all in Phase 0.

---

## 4. Phases in detail

### Phase 0 — JS mutation pipeline + JS conformance runner

**Goal / done:** a JS module that applies an operation batch to an in-memory file
map and produces **byte-identical** results to the Python pipeline, plus a JS
conformance runner that makes **all 62 `conformance/cases/*.json` pass**.

**Dependencies:** none (pure logic; no network, no UI, no git).

**What to build:**
- `web/src/mutation/` — the pipeline core, substrate-agnostic (operates on a
  `Map<path, content>` / plain object, *not* git):
  - op parsing + structural validation (same error codes as `conformance/README.md`
    §5; mirror `jadelens/operations.py`).
  - apply each op: `json_patch` (RFC 6902), `unified_diff`, `create_file`,
    `delete_path`, `rename_path` (content-map move; no git).
  - the wikilink post-apply pass (rewrite refs on rename, dangling-check on delete)
    — mirror Python's behavior in `jadelens` (see `DESIGN.md` §4.3 and the Python
    source).
  - ops-log entry construction (`{ts, commit_message, operations}`).
  - atomic batch semantics: on any failure, the input map is returned unchanged.
- `conformance/runners/js/` — the runner. Follow `conformance/README.md` §4
  pseudocode: load each case → seed an in-memory map from `before` (+ the
  `.jade/version` precondition) → apply `operations` → compare to `after`
  (success) or assert the `error` code + map-unchanged (rejection). Replicate the
  **log-line normalization** (parse each `.jade/operations-log/*.jsonl` line,
  blank `ts` to `<TS>`, compare structurally) — see the Python runner
  `_normalise`.

**How / gotchas:**
- **Byte-parity is the whole point and the main risk.** Data-file bytes must match
  Python exactly. The reference *is* JS here: JSON Patch results serialize as
  `JSON.stringify(obj, null, 2) + "\n"` (Python was made to match this —
  `dumps_js_canonical`). Verify the unified-diff applier and the wikilink-rewrite
  regex match Python char-for-char; the conformance suite is the arbiter.
- **Library choices need license + behavior checks** (see §6). Likely need a
  JSON-Patch lib (e.g. `fast-json-patch`) and a diff/patch lib (e.g. `diff`); both
  must (a) carry a permissive license and (b) byte-match Python's `jsonpatch` /
  the custom `unified_diff.py`. Where they don't match, wrap or replace. Don't
  assume parity — let conformance prove it.
- The pipeline is pure: **no git, no network, no IndexedDB** in this module. Those
  belong to Phases 1–2.

**Verification:** JS conformance runner green on all 62 cases (wire it into
`npm test` / Vitest reading `conformance/cases/*.json`); `npm run lint` clean.
Python suite still green (`uv run pytest`) — Phase 0 shouldn't touch Python.

---

### Phase 1 — Web: operation-queue + GitHub commit substrate

**Goal / done:** given an operation batch, the web app applies it locally (via
Phase 0), enqueues it, and **commits it to GitHub** via the Git Data API. No edit
UI and no conflict handling yet — drive it from a test harness.

**Dependencies:** Phase 0.

**What to build:**
- Extend `web/src/github.js` with write calls: create blob → create tree (on
  `base_tree`) → create commit (`parent` = base SHA) → `PATCH` ref. (See
  `docs/sync-and-conflicts.md` §1 "operation-queue model" and §6.)
- `web/src/sync/queue.js` (or similar) — IndexedDB state: **base commit SHA**,
  **pristine base content** (or refetch-by-SHA), **ordered queue of unpushed
  batches**, **live working content** (= base + replay). Extend `web/src/db.js`.
- Commit path: build the new tree from the batch's changed files **plus the
  appended `.jade/operations-log` line**, one commit per batch, pushed
  **sequentially** (build-and-push per batch against the confirmed tip — not
  build-all-then-push). See `docs/sync-and-conflicts.md` §1 and §6.

**How / gotchas:**
- **Atomicity is free at the ref update**; only the local bookkeeping after a
  successful push is the known soft spot (`docs/sync-and-conflicts.md` §6) — do
  the base-SHA bump + queue removal in **one IndexedDB transaction**. Do **not**
  build the fuller mitigations (that's deferred, §5).
- Needs a **write-scoped PAT**. Don't pre-flight scopes; attempt the write and
  surface errors (Phase 3 wires the UI message; the auth-error plumbing can start
  here).

**Verification:** unit tests with a mocked GitHub API (commit sequence, tree
contents incl. the log line, base-SHA advance). `npm run lint`, `npm test`.

---

### Phase 2 — Web: sync-on-focus + conflict detection + stash

**Goal / done:** on focus the app pulls remote; same-file local+remote changes
are detected as conflicts; the losing batch is stashed to `.jade/stash/`; the
indicator + stashed-changes view work.

**Dependencies:** Phase 0 (replay for ancestors/rebase), Phase 1 (commit path).

**What to build:**
- Sync-on-focus flow (`docs/sync-and-conflicts.md` §2): fetch, compare remote vs
  base, fast-forward non-conflicting files, route same-file collisions to the
  stash. Hook the existing focus/visibility handling.
- **File-level conflict detection** (§3) incl. **rename/delete semantics** (delete/
  move of X = X changed; directory op = every file under it; both-sides-touched =
  conflict regardless of op kind).
- **Stash** (§4): write `.jade/stash/<ts>-<uuid>.json` (schema in §4 — full batch
  + self-contained `ancestors` snapshot built from the **pristine baseline**,
  *not* the in-place-edited content), reset touched files to remote, commit the
  stash file + resets, push. Apply the **"stash everything from the first
  conflicting batch onward, full batches only"** rule.
- **Ops-log exclusion** (§5): a stashed batch's queued commit is **dropped, never
  committed** — it must not enter the synced ops-log.
- UI: the **conflict indicator** (warning emoji top-right while `.jade/stash/`
  non-empty) and the **stashed-changes view** (list entries: file, timestamp,
  human-readable op description; Done / Won't-do buttons → delete the entry,
  which is a normal synced commit).

**How / gotchas:**
- Ancestor snapshots require the **pristine base content** — make sure Phase 1's
  state model retains it (it does if built per §4). This is the subtle bit.
- Resolution (delete stash file) is itself a normal commit → flows through Phase 1.

**Verification:** unit/integration tests for the conflict state machine (the
A,B/C,D,E,F "stash from first conflict" example; rename-vs-edit; delete-vs-edit).
Manual: two-tab / two-PAT simulation. `npm run lint`, `npm test`.

---

### Phase 3 — Web: checkbox toggle (first real edit)

**Goal / done:** toggling a checkbox in rendered markdown commits a `unified_diff`
through Phases 1–2 and syncs; read-only-PAT errors are surfaced clearly.

**Dependencies:** Phases 0–2.

**What to build:**
- In the markdown render path (`MarkdownRenderer.jsx` / the checkbox node), on
  toggle: map the rendered checkbox back to its **source line/char**, derive a
  `unified_diff` flipping `[ ]`↔`[x]` at that line (`docs/web/editing.md`
  "Micro-edits"), and call the Phase-1 mutation path (one-op batch, immediate
  commit). Commit message = static description + file list (`DESIGN.md` §7.3).
- Wire PAT auth-error UX: a clear message; the read-only-PAT case must say so
  (`docs/sync-and-conflicts.md` §2 error handling).

**How / gotchas:**
- Source-line mapping is the fiddly part — the remark pipeline must preserve
  enough position info to locate the source checkbox. Check the existing remark
  plugins (`web/src/plugins/`).

**Verification:** unit test for diff derivation from a toggle; manual end-to-end
toggle → commit → push → (cross-device) sync. `npm run lint`, `npm test`,
`npm run build`.

> **End of the MVP slice.** After Phase 3 you have checkbox editing on a full,
> tested sync+conflict+stash spine.

---

### Phase 4 — `/jade`: auto-sync + stash + tooling commands

**Goal / done:** the Python tooling pulls-before / pushes-after every interaction
and runs the **same conflict/stash flow** with real git; the bot manages the
stash only via dedicated commands (never touching `.jade/`); SKILL.md says sync
is automatic.

**Dependencies:** Phase 0 (shared stash-entry format + ops-log-exclusion rule).
Can run in **parallel** with Phases 1–3.

**What to build:**
- Auto-sync in the tooling: pull before processing, push after
  (`docs/sync-and-conflicts.md` §2; `DESIGN.md` §12).
- Conflict/stash flow with real git (§4 "`/jade` (real git)"): on push rejection,
  `git fetch` → **discard the local unpushed batch commit including its ops-log
  line** (§5) → `git checkout <remote-ref> -- <touched files>` → write the
  `.jade/stash/` entry (identical schema) → `git add`/`commit`/`push`.
- **`jadelens stash list` / `jadelens stash resolve <id>`** console commands — the
  bot's only way to touch the stash; **no `.jade/` carve-out** (the protected-path
  rule in `DESIGN.md` §4.2 stays absolute).
- **Update the SKILL.md template** (`jadelens/templates/skill/`) — add the
  "syncing is automatic; do not pull/push or offer to" instruction. ⚠️ Do this
  **only in this phase**, when auto-sync actually exists — not before.

**How / gotchas:**
- The ops-log-exclusion step (discarding the local commit + its log append before
  re-committing as a stash) is the easy-to-miss part the design doc calls out.

**Verification:** Python tests for the conflict/stash flow + the `stash` commands;
`uv run pytest`. Verify a hand-made conflict produces a stash entry whose schema
matches what the web app writes.

---

### Phase 5 — Web: grow editing capabilities

**Goal / done:** text editing (session-batched, tiptap, drafts) and structured
creation (forms), per `docs/web/editing.md`.

**Dependencies:** Phases 0–3.

**What to build (incrementally, smaller sub-steps):**
- Text editing: edit-mode state machine, tiptap swap-in, save-on-(button | in-app
  nav), cancel, **in-app-nav vs app-switch detection**, **draft persistence** in
  IndexedDB incl. the startup draft-vs-remote → stash path
  (`docs/web/editing.md` "Edit-mode lifecycle", "In-app navigation…", "Draft
  persistence").
- Structured creation: schema-backed forms → one batch on submit.

**Verification:** per sub-step; `npm run lint`, `npm test`, `npm run build`.

---

### Phase 6 — Cross-client stash/sync conformance (future)

**Goal / done:** a conformance scope proving web and `/jade` produce **identical
stash entries and resolution commits** for the same conflict scenario.

**Dependencies:** Phase 4 (both clients implemented).

**Notes:** likely a **new** conformance scope, not additions to the existing
mutation suite (which tests op application, not sync). Defer until both clients
exist. This is the "more conformance cases" the owner anticipated.

---

## 5. Deferred — do NOT build yet

From `docs/sync-and-conflicts.md` and `DESIGN.md` §15.2 — intentionally out of
scope:

- **Inline-vs-sidecar promotion** (DESIGN §4.4) — doesn't exist in Python *or*
  JS; ignore it entirely until separately scheduled.
- **Identical-op dedupe** on conflict (`docs/sync-and-conflicts.md` §3, §6).
- **Post-push atomicity hardening** beyond the single IndexedDB transaction
  (the dedupe / client-tagged-commits options in `docs/sync-and-conflicts.md` §6).
- **Bot-assisted replay, auto-apply button, visual diff, ordering enforcement**
  for the stash (`docs/sync-and-conflicts.md` §4 "Deferred").
- Richer sync triggers (periodic/idle, manual "Sync now") — out unless the owner
  asks (they trimmed §8.2 to focus + save).

---

## 6. Cross-cutting concerns

- **Dependency licenses.** The project is PolyForm Noncommercial; new deps must
  carry a **permissive** license (MIT/BSD/Apache-2.0). Check before adding any JS
  lib (JSON-Patch, diff, tiptap, etc.). (`CLAUDE.md`.)
- **Byte-parity is contract.** Any JS op-application logic must match Python
  byte-for-byte on data files; the conformance suite is the judge. Treat a
  conformance mismatch as a bug in the new code, not the suite.
- **Atomicity invariants.** Remote (GitHub) commits are atomic at the ref update;
  the only soft spot is local post-push bookkeeping (`docs/sync-and-conflicts.md`
  §6) — mitigate with one IndexedDB transaction, defer the rest.
- **Protected paths stay absolute.** No client gets direct bot access to `.jade/`;
  the runtime/tooling writes there, and the bot uses `jadelens stash` commands
  (`DESIGN.md` §4.2; `docs/sync-and-conflicts.md` §4).
- **Ops-log = applied user-data changes only.** Stashed batches and stash/log
  machinery never appear in it (`DESIGN.md` §7.2; `docs/sync-and-conflicts.md` §5).
- **Changelog.** Add a `changelogs/<version>.md` entry when a phase actually ships
  user-visible behavior — not at design time.
- **Keep these docs current.** If implementation reveals a design gap, update the
  relevant doc (`docs/…`, `DESIGN.md`) in the same PR, and tick §8 here.

---

## 7. Quick verification reference

| Scope | Command (from) |
|---|---|
| Python unit + conformance | `uv run pytest` (repo root) |
| Conformance only | `uv run pytest conformance` |
| Web lint / test / build | `npm run lint` · `npm test` · `npm run build` (`web/`) |
| JS conformance runner | wired into `npm test` (Phase 0) |

---

## 8. Progress checklist (update + commit as you go)

**Phase 0 — JS pipeline + conformance runner**
- [ ] `web/src/mutation/` op parse + validation (error codes match §5)
- [ ] apply: json_patch / unified_diff / create_file / delete_path / rename_path
- [ ] wikilink post-apply pass (rename rewrite + delete dangling-check)
- [ ] ops-log entry construction + atomic-batch (input unchanged on failure)
- [ ] `conformance/runners/js/` runner + log-line normalization
- [ ] all 62 conformance cases green in JS; `npm test`/`lint` clean

**Phase 1 — Web commit substrate**
- [ ] `github.js` write path (blob→tree→commit→ref)
- [ ] IndexedDB queue state (base SHA, pristine base, queue, working content)
- [ ] sequential build-and-push; log line in the tree; single-IDB-txn bookkeeping
- [ ] mocked-API unit tests green

**Phase 2 — Web sync + conflict + stash**
- [ ] sync-on-focus flow
- [ ] file-level conflict detection incl. rename/delete semantics
- [ ] stash write (full batch + pristine ancestors) + reset + commit; "first-conflict-onward" rule
- [ ] ops-log exclusion of stashed batches
- [ ] conflict indicator + stashed-changes view (Done / Won't-do)
- [ ] conflict state-machine tests green

**Phase 3 — Web checkbox toggle (MVP)**
- [ ] toggle → source-line mapping → unified_diff → commit
- [ ] static commit message (description + files)
- [ ] read-only-PAT error surfaced clearly
- [ ] end-to-end toggle→sync verified; lint/test/build green

**Phase 4 — /jade auto-sync + stash**
- [ ] pull-before / push-after every interaction
- [ ] real-git conflict/stash flow (discard local commit + log line first)
- [ ] `jadelens stash list` / `resolve` commands (no `.jade/` carve-out)
- [ ] SKILL.md template updated (sync is automatic)
- [ ] Python tests green; stash schema matches web

**Phase 5 — Web grow editing**
- [ ] text editing (session/tiptap/save/cancel/nav-detection)
- [ ] draft persistence + startup draft-vs-remote → stash
- [ ] structured-creation forms

**Phase 6 — Cross-client conformance (future)**
- [ ] stash/sync parity scope (web ↔ /jade)
