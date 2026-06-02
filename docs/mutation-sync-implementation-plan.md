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

> **First, settle the queue ↔ repoCache wiring (§6.1).** This phase is where the
> read path first feeds the queue (`init` from a full read + `getBranchHead`
> SHAs) and where remote updates must land on the content authority. Implement
> the §6.1 contract here — including the truncation guard on `init`.

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
- **Render from the content authority (§6.1).** After a toggle commits, the view
  must re-render from `queue.workingMap`, and `repoCache` must be refreshed from
  it — otherwise a reload shows the pre-toggle state. This is the §6.1 contract's
  render half.

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

**Goal / done:** text editing (session-batched, tiptap, drafts), per
`docs/web/editing.md`.

**Dependencies:** Phases 0–3.

**What to build (incrementally, smaller sub-steps):**
- Text editing: edit-mode state machine, tiptap swap-in, save-on-(button | in-app
  nav), cancel, **in-app-nav vs app-switch detection**, **draft persistence** in
  IndexedDB incl. the startup draft-vs-remote → stash path
  (`docs/web/editing.md` "Edit-mode lifecycle", "In-app navigation…", "Draft
  persistence").

> **Not here: structured-creation forms.** The third mutation tier (forms) acts
> *only* on data kinds with a registered schema/view, and **none exist yet** —
> the schema / view-registry mechanism (DESIGN §4.9) is a separate unbuilt
> feature. With all data freeform, there is nothing to put in a form. Forms are
> gated on that feature and are out of scope for this plan (see §5).

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
- **Structured-creation forms** (the third mutation tier) — gated on a
  schema / view-registry feature (DESIGN §4.9) that doesn't exist yet. No
  registered data kinds = nothing to form. Out of scope until schemas land.
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

### 6.1 Open: queue ↔ repoCache integration (deferred to UI-wiring, Phase 2/3)

**Decision (owner-confirmed): keep the queue's `sync` IndexedDB store *parallel*
to the existing `repo` read cache; the queue is the content authority once
initialised.** Phase 1 shipped the store this way but did **not** wire it to the
read cache or the render path — that wiring is deferred to when editing goes live
(read-path→`init` in Phase 2's sync, render-from-`workingMap` in Phase 3). Until
then `repoCache` is the only content layer the app actually reads. The contract to
implement when wiring:

- **Content lives in three maps** across two stores: `repoCache.contentMap` (store
  `repo`) vs the queue's `baseMap` + `workingMap` (store `sync`). They overlap;
  the repo content can sit in IDB ~2×. Accepted — cheap at single-user text
  volumes. The cost we're managing is **drift**, not bytes.
- **One render authority.** Once a repo is initialised in the queue,
  `queue.workingMap` is the single source of truth for rendering. `repoCache`
  demotes to the cold-start / no-flicker preload (`getPreloadedRepo`,
  `getSessionCache` in `repoCache.js`) and must be **refreshed from
  `workingMap`** after every edit/push so a reload doesn't show pre-edit content.
  Render rule: prefer `workingMap` when the queue is initialised, else
  `repoCache.contentMap`.
- **The SHA gap.** The read path (`github.js`) fetches the tree *by branch name*
  and returns `{items, branch, truncated}` — no commit/tree SHA. The queue's
  `init` needs both; get them from `githubWrite.getBranchHead` when wiring the
  read path to `init`.
- **⚠️ Truncation is a correctness constraint, not a nicety.** `repoCache` may hold
  a `truncated` (partial) tree for large repos. `computeTreeChanges(base, new)`
  reads a missing-because-truncated file as a **deletion** — so the queue must
  **never `init` from a truncated content map**. Guard `init` to refuse (or fully
  hydrate first) when `truncated` is set. No guard exists yet; add it with the
  wiring.



## 7. Quick verification reference

| Scope | Command (from) |
|---|---|
| Python unit + conformance | `uv run pytest` (repo root) |
| Conformance only | `uv run pytest conformance` |
| Web lint / test / build | `npm run lint` · `npm test` · `npm run build` (`web/`) |
| JS conformance runner | wired into `npm test` (Phase 0) |

---

## 8. Progress checklist (update + commit as you go)

**Phase 0 — JS pipeline + conformance runner** ✅ DONE
- [x] `web/src/mutation/` op parse + validation (error codes match §5)
- [x] apply: json_patch / unified_diff / create_file / delete_path / rename_path
- [x] wikilink post-apply pass (rename rewrite + delete dangling-check)
- [x] ops-log entry construction + atomic-batch (input unchanged on failure)
- [x] `conformance/runners/js/` runner (`run.mjs`) + log-line normalization
- [x] all 62 conformance cases green in JS; `npm test`/`lint`/`build` clean

> Notes: full pipeline built (all 5 ops), not just the checkbox path — the whole
> suite is green, so the JS runner is complete. JSON-Patch (RFC 6902) and the
> gitignore matcher were **hand-rolled** (zero new deps) to keep the shared core
> dependency-free; the gitignore matcher is a documented subset (root .gitignore,
> common patterns) sufficient for the suite. Byte-canonical JSON serialisation is
> JS-native (`JSON.stringify(obj, null, 2) + "\n"`). The pipeline is pure logic
> (no git/network/IndexedDB) — those belong to Phase 1.

**Phase 1 — Web commit substrate** ✅ DONE
- [x] GitHub Git Data API write path — `web/src/sync/githubWrite.js`
      (`computeTreeChanges` tree-diff; `commitFileMap` = tree→commit→ref using
      inline blob content + `sha:null` deletes; `getBranchHead`;
      `PushConflictError` on 422 non-fast-forward; `GitHubWriteError` w/ status)
- [x] mocked-API unit tests green (`githubWrite.test.js`)
- [x] IndexedDB queue state (base SHA, pristine base, queue, working content)
- [x] sequential build-and-push across queued batches; single-IDB-txn bookkeeping
- [x] integration: pipeline (`mutation/run`) → queue → `commitFileMap`

> Note: the write layer uses one `create tree` call with **inline `content`**
> for added/modified entries (GitHub creates the blobs) + `sha:null` for deletes,
> rather than separate `create blob` calls — fewer round trips, same atomicity
> (only the ref update mutates remote).
>
> The operation queue (`web/src/sync/opQueue.js`) holds all sync state in a
> **single record** behind a small storage port (`queueStore.js`): `baseCommitSha`,
> `baseTreeSha`, pristine `baseMap`, the ordered `queue` of unpushed batches, and
> the live `workingMap`. A single-record write is one structured-clone IDB
> transaction, so the post-push base-advance (SHA bump + queue shift) is atomic
> "for free" — the §6 known-gap mitigation. `OpQueue.push` builds-and-pushes one
> commit **per batch** sequentially, parenting each on the previous success and
> **stopping at the first `PushConflictError`** (the Phase 2 stash hook); the
> remaining queue and the advanced base are preserved.
>
> **Testability decision (owner-confirmed): storage abstraction over a
> fake-IndexedDB dep.** The queue logic is written against the `QueueStore` port;
> `createMemoryQueueStore()` (structuredClone-isolated) backs the unit tests,
> `createIdbQueueStore()` (db.js store `sync`, db version bumped 2→3) backs the
> browser. Zero new deps. The push driver takes an injectable `commit` fn so the
> sequential/conflict/advance logic is tested without network. Per-batch
> `timestamp` is frozen at enqueue and reused on push-replay so the ops-log line
> is byte-identical either way. Tests: `web/src/sync/opQueue.test.js` (10 cases).
>
> Not yet wired into the app UI — `init()`/`enqueue()` are driven by tests; the
> real read-path → `init` and edit → `enqueue`/`push` wiring lands with sync
> (Phase 2) and the checkbox edit (Phase 3). **The queue's `sync` store is
> deliberately parallel to the existing `repo` read cache; how they reconcile
> (render authority, refresh-on-edit, the truncation guard) is the deferred §6.1
> contract — implement it when wiring, not before.**

**Phase 2 — Web sync + conflict + stash** ✅ DONE (one carry-over to Phase 3)
- [x] file-level conflict detection incl. rename/delete semantics  ← (2a) `conflicts.js` done
- [x] stash write (full batch + pristine ancestors) + reset + commit; "first-conflict-onward" rule
      ← (2b) entry construction + (2c) `OpQueue.sync()` stash bookkeeping commit
- [x] ops-log exclusion of stashed batches  ← (2c): stash commit bypasses the
      mutation pipeline (no ops-log line); stashed batches are dropped, never pushed
- [~] sync-on-focus flow  ← (2c) `OpQueue.sync()` is the full fetch→rebase/
      stash→push cycle (sync-on-focus + sync-on-save unified); (2d) wires the
      read-path → `queue.init()` baseline (`syncController.initQueueFromRead`,
      truncation-guarded, fetches the head SHAs). The window **focus event**
      hookup + render refresh is deferred to Phase 3, where render-from-
      `workingMap` makes the queue the content authority — wiring a focus
      listener now (read-only app, nothing to push) would create the dual-
      authority drift §6.1 warns against.
- [x] conflict indicator + stashed-changes view (Done / Won't-do)  ← (2e):
      `StashView.jsx` (lists entries: timestamp + per-op `describeOperation`
      lines + Done/Won't-do → `resolveStashEntry`), `⚠️` indicator in `Main`
      shown while the queue's stash is non-empty, `stash` page wired in `App`.
      `FileBrowser` fires `onContentLoaded` → `App.refreshStash` to recompute the
      count. Underlying logic unit-tested (2e-i); React wiring verified via build
      (repo has no component-test infra — not adding it unprompted).
- [x] conflict state-machine tests green  ← `conflicts.test.js` + `sync.test.js`
      (fast-forward rebase, first-conflict-onward stash, pristine ancestor,
      stash-commit race / no-data-loss, truncated remote)

> **Phase 2 notes (complete — kept as a map of the sync layer).** Built in
> sub-batches, pure logic first then UI, each committed+pushed:
> - **(2a) conflict detection** — `web/src/sync/conflicts.js`: `changedPaths`
>   (base↔remote diff), `batchTouchedPaths` (per-batch concrete paths incl.
>   rename from/to + recursive directory delete/rename), `firstConflictIndex`
>   ("first-conflict-onward" pivot). Pure; unit-tested.
> - **(2b) stash entry** — `web/src/sync/stash.js`: build the
>   `docs/sync-and-conflicts.md` §4 entry (`{timestamp, ancestors, operations}`)
>   + filename `<compactISO>-<shortuuid>.json`. **Decision:** `operations` stores
>   the raw op objects verbatim (the `{op,path,…}` wire format), NOT the
>   illustrative `{type,path,payload}` shape sketched in the design doc — the raw
>   format is the conformance-pinned, cross-client-identical one (Phase 6). Doc
>   updated to match.
> - **(2c) sync orchestration** — `OpQueue.sync()` (fetch remote → plan →
>   rebase/fast-forward or stash-from-first-conflict → push kept + stash
>   bookkeeping commit). Pure `computeSyncPlan` factored out for tests.
> - **(2d) app wiring** — ✅ read-path→`init` done (`syncController.js`:
>   `getQueue()` singleton + `initQueueFromRead`, `getBranchHead` SHAs, §6.1
>   truncation guard, skip-if-pending-work; wired into `FileBrowser` load,
>   best-effort/non-blocking). The focus-event listener + render-from-`workingMap`
>   are intentionally folded into Phase 3 (avoids dual-authority drift while
>   read-only).
> - **(2e) UI** — ✅ conflict indicator (`⚠️` in `Main` while the queue's stash
>   is non-empty) + `StashView` page (Done / Won't-do → `resolveStash` = a normal
>   bookkeeping commit). 2e-i = logic (`describeOperation`, `OpQueue.resolveStash`,
>   controller `getStashEntries`/`resolveStashEntry`); 2e-ii = React components +
>   `App`/`Main`/`FileBrowser` wiring.
>
> **Carry-over into Phase 3** (intentional, not a gap): the window **focus-event**
> hookup that calls `OpQueue.sync()` is deferred to Phase 3, where rendering flips
> to the queue's `workingMap` (§6.1) — doing it in Phase 2, while the app is
> read-only with nothing to push and renders from `repoCache`, would create the
> dual-authority drift §6.1 warns against. `OpQueue.sync()` itself is built and
> tested; Phase 3 just attaches it to `visibilitychange`/`focus` and refreshes the
> view from `workingMap` after each sync/edit.

**Phase 3 — Web checkbox toggle (MVP)** ✅ DONE (one documented limitation)
- [x] toggle → source-line mapping → unified_diff → commit
- [x] static commit message (description + files)
- [x] read-only-PAT error surfaced clearly
- [x] end-to-end toggle→sync: automated coverage + lint/test/build green
      (live two-tab / cross-device check is the owner's — no component-test infra)

> **Phase 3 notes (complete).** Sub-batches:
> - **(3a) edit logic** — `web/src/edit/checkbox.js` `buildCheckboxToggle(content,
>   line, path)` → one-op `unified_diff` batch flipping `[ ]`↔`[x]` at the source
>   line + static commit message. `syncController.commitEdit()` = enqueue →
>   optimistic `push` → on conflict `sync` (stash) → return new working content +
>   status; classifies read-only-PAT (403/401) errors, silent on network. Tested.
> - **(3b) renderer** — interactive checkbox in `MarkdownRenderer` via a per-`li`
>   context (`edit/checkboxContext.js`) carrying the mdast source line; the
>   `input` override (`TaskCheckbox`) reads it + `onToggle(line, checked)`.
>   `checkboxLine.test.js` pins the source-line mapping against the real remark
>   pipeline.
> - **(3c) wiring** — `FileView`→`App.handleCheckboxToggle`: derive op,
>   `commitEdit`, re-render from `workingMap`, refresh `repoCache`/session
>   (`updateCachedFile`, the §6.1 render half), stash/error toasts, lazy
>   queue-init (covers reload-straight-into-a-file).
> - **(3d) focus sync** — the Phase-2 carry-over, now done: `visibilitychange`/
>   `focus` → `OpQueue.sync()` → refresh stash indicator + re-render the open file
>   from `workingMap`. Concurrency-guarded; silent on offline/transient/auth.
>
> **Documented limitation (remaining §6.1 slice).** A focus-sync updates the open
> file + the queue's content authority, but the **FileBrowser tree cache**
> (`repoCache` items/session) is not refreshed from `workingMap` on focus, so the
> *tree* can show stale structure (added/renamed/deleted files) until the next
> full load / navigation to main remounts FileBrowser. Modified open-file content
> is fresh; only the tree listing lags. The clean fix is the full render-
> authority flip — make `workingMap` the single source the tree renders from too
> — which is larger than the MVP needs. Tracked for a Phase 5 follow-up.

**Phase 4 — /jade auto-sync + stash** ✅ DONE
- [x] pull-before / push-after every interaction  ← (4c) wired into `jadelens-apply`
- [x] real-git conflict/stash flow (discard local commit + log line first)  ← (4b)
      `jadelens/sync.py` (`push`: rebase-if-disjoint / stash-on-conflict; ops-log
      union-merged; conflict detection ignores `.jade/`)
- [x] `jadelens stash list` / `resolve` commands (no `.jade/` carve-out)  ← (4c)
      `cli.py` + `sync.list_stash`/`resolve_stash`
- [x] SKILL.md template updated (sync is automatic)  ← (4d) "Syncing is automatic
      — never do it yourself" section + the `jadelens stash` commands
- [x] Python tests green; stash schema matches web  ← (4a) `jadelens/stash.py`
      byte-identical to `stash.js` (serialization pinned); 319 Python tests green

> **Phase 4 notes (complete).**
> - **(4a)** `jadelens/stash.py` — ports `stash.js` for byte-identical entries.
> - **(4b)** `jadelens/sync.py` — `pull`/`push` over real git. Push reconciles a
>   non-fast-forward: disjoint data files → rebase (ops-log union-merged via local
>   `.git/info/attributes`) → push; same-file conflict → stash all unpushed
>   batches (recovered from their ops-log lines, pristine ancestors from the
>   merge-base), reset to remote, commit the stash files (no ops-log line), push.
>   **Documented simplification:** any conflict stashes the *whole* unpushed range
>   (vs the web's first-conflict-onward partial-keep) — safe, exact for the common
>   single-commit case; finer parity is Phase 6.
> - **(4c)** `jadelens-apply` does pull-before + push-after (local-first: a push
>   failure never loses the committed change; a stash prints a clear note).
>   `jadelens stash list/resolve` are the bot's only stash access.
> - **(4d)** SKILL.md template tells the bot syncing is automatic and to use the
>   `jadelens stash` commands (never touch `.jade/`).
>
> ⚠️ **Open decision for the owner (not actioned — release/versioning):** Phases
> 1–4 ship user-visible behaviour (web editing, sync, stash, /jade auto-sync) that
> goes beyond what `changelogs/v0.1.0.md` scopes ("No web app", "Manual syncing").
> Whether to (a) expand the v0.1.0 changelog, or (b) cut a new `changelogs/v0.2.0.md`
> + bump the data version (which touches the deferred §14 migration story) is a
> release decision left for you — I didn't bump versions or rewrite the v0.1.0
> scope unilaterally. The plan checklist + KNOWN_ISSUES are the live record meanwhile.

**Phase 5 — Web grow editing**
- [ ] text editing (session/tiptap/save/cancel/nav-detection)
- [ ] draft persistence + startup draft-vs-remote → stash
- [ ] ~~structured-creation forms~~ — gated on schema/view registry (out of scope; see §5)

**Phase 6 — Cross-client conformance** ✅ DONE
- [x] stash/sync parity scope (web ↔ /jade)  ← `conformance/stash-cases/` (6
      fixtures) + `runners/python/test_stash_conformance.py` +
      `runners/js/run-stash.mjs` (wired into `npm test`). Both clients build the
      same entry and serialise the same exact bytes (edit/created-omitted/dir-
      delete-subtree/rename/sorted+non-ASCII/multi-file). README §9 documents it.

> **Phase 6 notes.** Scoped to **stash-entry** parity (the cross-client artifact
> that `jadelens/stash.py` ↔ `web/src/sync/stash.js` must agree on byte-for-byte).
> Full sync/resolution-*commit* parity (the git-vs-GitHub-API plumbing) is not
> conformance-pinned — it's inherently substrate-specific and covered by each
> client's own integration tests (`test_sync.py`, `sync.test.js`); the portable,
> comparable artifact is the stash file, which this scope nails down.
