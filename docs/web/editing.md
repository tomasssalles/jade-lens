# Web app — manual editing & the mutation model

How user-driven data changes happen in the web app UI. The companion doc
`docs/sync-and-conflicts.md` covers what happens *after* a change is committed
(sync, conflicts, the stash); this doc is about producing the change.

> **Status: partly implemented; growing.** Shipped: **checkbox toggling** on top
> of the full sync + conflict + stash machinery. Groundwork landed (no UI yet):
> the unified-diff generator, the draft store + startup reconciliation, and the
> render-authority flip. Designed-but-unbuilt below: raw markdown editing, the
> JSON value micro-edits + edit gesture, file move/delete, and raw JSON editing.
> See `docs/mutation-sync-implementation-plan.md` Phase 5 for the build order and
> what's pure-groundwork vs browser-verified UI.

## The unifying rule

Every UI mutation produces the **same operation types the bot produces**
(`json_patch`, `unified_diff`, `create_file`, `delete_path`, `rename_path`) and
flows through the **same mutation pipeline** as bot edits (DESIGN §9.2). One code
path for all data mutation, one audit substrate. The UI never invents a
side-channel.

The user never thinks about "batching" or "committing." Those concepts are
hidden behind UX modes that map naturally onto commit boundaries.

## Three tiers

### 1. Micro-edits — immediate commit

Small, self-contained interactions: toggling a checkbox, picking a date, changing
a single metadata field, moving or deleting a file. One gesture → one change →
one commit → one operations-log entry. No mode change, no save button, no pending
state for the user to manage.

This is the default for anything that modifies a single value in place (or makes
a single file-level change). The JSON Patch / unified diff / structural op is
trivial to derive because exactly one thing changed.

**Entering an edit — the deliberate gesture.** Reading is the common case and a
stray tap must never start an edit. So every in-place edit is opened by a
**deliberate gesture: long-press on touch, double-click on desktop** — not a
single tap/click. This is uniform across *all* micro-edits, **including the
checkbox** (whose toggle therefore moves from single-tap to the same gesture, for
consistency and to avoid accidental toggles). Implementation note: long-press
natively triggers selection / the context menu on mobile, and double-click
selects a word on desktop — both must be suppressed on editable targets.

**No-op guard.** Every edit compares the resulting value against the original and
**does nothing if they're equal** — no commit, no operations-log entry. Opening a
picker and choosing the same date, or an editor and changing nothing, is not a
mutation. (Same principle the draft reconciler already applies.)

*Examples — JSON values (one `json_patch` `replace` at the field's path):*
- **Date / time:** native picker → ISO string.
- **Boolean:** a toggle/switch control → `true`/`false`.
- **Wikilink:** a file picker → the chosen `[[path]]`.
- **Number:** a numeric-only input field.
- **String:** opens the raw markdown editor (Tier 2) on that field — short strings
  commit immediately on the same gesture model.

Type changes (e.g. `null` → integer) and array/object edits have no simple
value-UI; they go through **raw JSON editing** (below).

*Examples — markdown:*
- **Checkbox in rendered markdown:** determine the source line → derive a
  `unified_diff` flipping `[ ]`↔`[x]` at that line → one-op batch.

*Examples — file-level structural edits (whole-file ops, immediate commit):*
- **Move / rename a file or directory:** one `rename_path` op. The pipeline's
  post-apply pass **auto-rewrites every `[[wikilink]]`** pointing at the moved
  path (and anything under it), so references heal automatically — nothing else
  to do.
- **Delete a file or directory:** one `delete_path` op. The pipeline **rejects**
  the delete if the path is still referenced by any wikilink
  (`DELETE_DANGLING_WIKILINK`); the UI surfaces that error and **names the
  referencing files** so the user can clear the links first. (The workflow does
  *not* auto-remove references — that's deliberately out of scope.)

### 2. Text editing — batched by session

The user enters edit mode on a markdown file or a JSON string field (an editor
swaps in for the reader). They make any number of changes and exit. Everything in
the session commits together as **one batch** (one commit, one log entry).

> **Editor choice (owner-confirmed): ship a raw markdown editor first, layer
> WYSIWYG on later.** The first editor is a **raw-markdown-with-syntax-highlighting**
> view (CodeMirror 6, MIT — permissive enough under PolyForm). Editing the source
> bytes directly sidesteps the markdown round-trip fidelity risk of a WYSIWYG
> editor and pairs cleanly with the 0-context diff *generator* (Phase 5a), which
> diffs the exact before→after text. A WYSIWYG experience (tiptap/ProseMirror)
> can be added afterwards, keeping the raw editor as the permanent "source mode"
> alternative for technical edits.

Exit paths:

- **Save** — explicit save button, **or in-app navigation** to another page.
  Changes commit.
- **Cancel** — explicit button. Changes discarded; the file reverts to its
  pre-edit state. No mutation, no log entry.
- **App backgrounded / closed** — nothing commits. The editing session stays
  alive. If the OS kills the app, a draft persists (see below) and is recovered
  on next open.

**Critical distinction:** switching to another app on the phone (e.g. to check a
date) is **not** navigation and does **not** save. Only navigating *within* the
app saves.

#### Raw JSON editing — the structural escape hatch

Complex or structural JSON changes (adding/removing/moving keys, editing arrays,
type changes) that the leaf-value micro-edits can't express are done by editing
the **whole JSON file as raw text**, in a syntax-highlighted editor (bracket
matching, etc.). This is the general-purpose fallback that covers everything;
friendly per-type UIs are layered on top over time for the common cases.

- **On save:** parse + validate the text. On a parse error, **keep the editor
  open** and show a helpful message (line/column) rather than discarding work.
- **Deriving the op:** the op model forbids `unified_diff` on `.json` files, so a
  raw JSON edit must become a **`json_patch`**. We derive it by a *structural*
  diff of the parsed before/after objects (recurse: changed leaf → `replace`,
  removed key → `remove`, added key → `add`; arrays element-wise or whole-array
  replace). The existing applier conformance-pins the generator via round-trip
  (generate → apply → compare to the canonically re-serialized target).
- **Caveats:** structure-only — pure key-reordering or whitespace-only changes
  don't survive the canonical re-serialize (acceptable; key order isn't
  semantic). Generated patches are correct but not necessarily minimal (no
  `move`-detection cleverness).

This keeps the door open to gradually replacing raw JSON editing with
user-friendly structured UI (a future view-registry feature) without ever leaving
a structural change unexpressible in the meantime.

### 3. Structured creation — batched by form

Creating a record with a known schema (calendar event, structured task, …) uses
a form. The form is the batch container: it opens, gets filled in, and on submit
the whole record commits as one batch (typically a `create_file` or a JSON Patch
`add`). Applies only to data types with a registered schema/view (the view
registry); freeform bot-created data doesn't use forms.

On cancel or navigation away from an unsubmitted form: discard, no draft
persistence (forms are quick to refill; the cost of losing one is low).

## Why not open-ended batches

We considered (and rejected) letting users explicitly open a batch, change many
files, and submit all at once (GitLab-review style):

- **UX burden** — the user has to track a "pending batch" state and remember to
  submit; forgetting strands changes in limbo.
- **Conflict risk** — a long-lived pending batch on the phone interacts badly
  with the bot's commits on the laptop; immediate commits keep each device
  current.
- **The motivation doesn't apply** — GitLab batches to reduce reviewer
  notification noise. JADE LENS is single-user; nobody to notify.
- **Simpler patches** — committing per field change keeps each JSON Patch trivial.

The three-tier model captures every case where batching genuinely helps without
making the user manage batch state.

## Edit-mode lifecycle (text editing)

```
VIEWING → [tap edit] → EDITING → [save / in-app nav] → VIEWING (commit)
                          │
                          ├─ [cancel] ───────────────→ VIEWING (discard)
                          ├─ [app backgrounded] ─────→ EDITING (no change; draft saved)
                          └─ [app killed by OS] ─────→ draft in IndexedDB
                                                        → on reopen: EDITING (restored)
```

On **enter EDITING:** snapshot current content as the "before" state; swap the
reader (`react-markdown` / `MarkdownRenderer`) for the editor (the raw CodeMirror
source editor first; a WYSIWYG editor later).

On **save:** get the editor's markdown (for the raw editor this is its content
verbatim; for a future WYSIWYG editor, serialize back to markdown) or extract the
field value; diff against the "before" snapshot to derive the op(s) — one
`unified_diff` for a markdown file/field (via the Phase 5a generator), or one JSON
Patch `replace` for a card-viewer field; run the mutation pipeline; swap the
reader back.

On **cancel:** discard the editor content; swap back to the unchanged "before."

## In-app navigation vs. app switching

The save-triggering distinction is detected by source:

- **In-app navigation** — the app's own router. On route change while an edit
  session is active, fire the save logic (auto-save is the recommended default
  over prompting, to reduce friction). Use the router's navigation guard
  (e.g. React Router `useBlocker`) and/or `beforeunload`.
- **App switching** — OS-level, surfaced as `visibilitychange` / `pagehide`.
  **Do not save** on these; the session stays active. **But do persist a draft**
  to IndexedDB on `visibilitychange` (when `document.hidden` becomes true) as a
  safety net against the OS killing a backgrounded app.

## Draft persistence

Drafts are **device-local** (IndexedDB) and protect against the OS killing an
in-progress editing session. They are distinct from the stash (which is for
*committed-but-conflicting* changes and lives in the synced repo).

**Record shape:**

```js
{
  id: "draft_<filePath_hash>",
  filePath: "projects/kitchen-renovation.md",
  editorContent: "<current editor content (markdown source)>",
  beforeSnapshot: "<file content when editing started>",
  timestamp: "<ISO8601>",
  editContext: {
    type: "markdown_file" | "json_field",
    jsonFilePath: "projects.json",   // for json_field
    fieldPath: "/Kitchen renovation/Notes"
  }
}
```

**Written:** on `visibilitychange`→hidden (backgrounded); periodically while
editing (~30s safety net); on `beforeunload` (best-effort, not guaranteed on
mobile).

**Cleared:** on successful save (committed) or explicit cancel.

**On app startup**, for each draft found:
- If the file's current content **matches** `beforeSnapshot` → safe to restore;
  reopen the editing session with the draft content.
- If the file **changed** since the draft was created (content ≠ `beforeSnapshot`)
  → effectively a conflict. Derive the op from diffing `beforeSnapshot` against
  `editorContent`, **stash it** (see `docs/sync-and-conflicts.md`), discard the
  draft, and show the conflict indicator.

## Commit messages for UI edits

The runtime writes the message — the user never does. The format is a **static
operation description plus the affected-file list** (usually a single file),
e.g. `Manual edit: toggled checkbox — projects/leasing.md`. It is intentionally
redundant with the operations-log entry; the point is to keep `git log` skimmable
and searchable. (DESIGN §7.3.)
