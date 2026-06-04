# Sync & conflicts

How JADE LENS syncs the data repo between devices and resolves conflicts. Spans
both clients: the **web app** (GitHub REST API) and the **`/jade` Claude Code
skill** (local git clone). The companion doc `docs/web/editing.md` covers how a
web-app change is produced; this doc covers everything from "a change is
committed locally" onward.

> **Status: design (not yet implemented).** Neither client syncs or stashes
> today (the web app is read-only; the `/jade` tooling syncs manually). This
> records the agreed design. The first implementation increment ships sync +
> conflict + stash together with web-app checkbox toggling (see
> `docs/web/editing.md`).

---

## 1. Storage substrate

The data repo is a **GitHub repository of state files** (JSON + markdown); each
atomic change is a commit. This is the current substrate; a later move to a
Postgres-backed store is anticipated (DESIGN §15.2), so the sync/conflict design
is kept **substrate-agnostic** — nothing here depends on git's merge machinery,
and the stash format is self-contained rather than coupled to git.

### Web app: the operation-queue model

The web app is a static SPA with **no local git** (and can't get one — GitHub's
git smart-HTTP endpoints aren't CORS-accessible from a Pages origin without a
third-party proxy, which is unacceptable for private data). It commits via the
**GitHub Git Data API**:

- A "local commit" is a queued **operation batch** + the resulting file content +
  the **base commit SHA** it was applied on top of, persisted in IndexedDB.
- The IndexedDB state we keep is therefore: (1) base commit SHA, (2) pristine
  base content (or refetchable by SHA) — the ancestor source, (3) the ordered
  queue of unpushed batches, (4) live working content (= base + replay of queue).
- A push is: create blob(s) → create tree (on `base_tree`) → create commit
  (`parent` = base SHA) → `PATCH` the ref. Only the ref update mutates remote
  state; earlier objects are unreferenced until then (so a mid-sequence failure
  leaves nothing to roll back — just retry).

This was chosen over running real git in the browser (e.g. isomorphic-git)
because: the REST API is the transport the app already reads through (CORS-clean,
no proxy); git's headline feature (3-way merge) is one we deliberately *don't*
use (conflicts are file-level — see §3); and the queue model maps cleanly onto a
future Postgres substrate where a browser git engine would be dead weight.

### `/jade`: real git

The Claude Code tooling runs against a real local clone and uses ordinary git
(`fetch`, ref comparison, `checkout <remote-ref> -- <path>`, `commit`, `push`).

---

## 2. Sync

### When it happens

- **On focus** — app foreground / tab activation pulls latest remote. Usually a
  fast no-op.
- **On save** — committing a local change (micro-edit, editing-session save, form
  submit) pushes.
- **`/jade`** — the tooling pulls **before** processing and pushes **after**
  every interaction. Deliberately aggressive (every interaction); throttle later
  only if it causes problems (rate limits, perf). The bot's SKILL.md is told
  syncing is automatic and it must not pull/push or offer to.

Sync is a background concern; the UI never blocks on it. Changes apply locally
first, then sync.

### Sync-on-focus flow

```
1. Fetch remote state; compare remote HEAD with local base.
2. No new remote commits → done (common case).
3. New remote commits:
   a. Identify remotely-changed files.
   b. For each: no local change → fast-forward the local copy to remote.
                local change present → CONFLICT (§3).
   c. Advance local base to remote.
4. Re-render any visible views showing updated files.
```

### Sync-on-save flow

```
1. Apply locally (already done by the mutation pipeline).
2. Attempt push.
3. Succeeds → done.
4. Rejected (remote ahead — non-fast-forward, detected via the stale parent SHA):
   pull (sync-on-focus logic), which routes any same-file collisions into the
   stash (§3), then push the surviving batches.
```

### Error handling

- **Auth failure** (PAT refused/expired/insufficient scope) — surface clearly to
  the user; sync stops until fixed. If the failure is specifically a **read-only
  PAT** rejecting a write, the message must make that obvious. (We don't
  pre-flight the token's scopes — we attempt the write and surface the error.)
- **Repo not found** (misconfigured/deleted remote) — surface clearly.
- **No internet** — completely silent. The app works offline; sync resumes on
  reconnect. No error, no toast.
- **Rate limit / transient** — silent retry with backoff; surface only if retries
  are exhausted.

---

## 3. Conflict detection

A conflict is when sync pulls remote changes to a file that was **also changed
locally** since the last successful sync.

- **Different files on different devices** → no conflict; both sets apply. The
  common case.
- **Same file on both** → conflict. The **pushed version (whoever synced first)
  is ground truth** and is never rolled back — a successfully pushed change
  disappearing is unacceptable. The second device's local change is the one that
  yields, into the stash (§4).

Detection is strictly **file-level**. No within-file merge — not at the JSON-path
level, not the array-element level, not the text-line level. Within-file merging
needs data semantics (what's an "entry," how indices shift) and is complex,
opinionated, and fragile. File-level is simple, correct, and sufficient given
same-file conflicts are expected to be rare.

### Rename / delete semantics

A file "changed" covers structural ops, recursively:

- **Delete X** → X changed.
- **Move X→Y** → X changed (and Y must not pre-exist).
- **Directory op** → every file under it (recursive) changed.

Any file touched on **both** sides is a conflict regardless of op kind —
move-vs-edit, move-vs-move, delete-vs-edit, etc.

### Identical-change dedupe (deferred)

A planned convenience: if both sides applied the **identical operation** (same op
dict — not same commit message/timestamp), keep one and skip the conflict.
Deferred for now; comparing op dicts is the intended approach (content comparison
is unsound once the remote has *further* changes after the duplicate). This also
closes the spurious-stash window in §6.

---

## 4. The stash

When a conflict is detected, the losing side's local changes are **stashed**
rather than lost — saved for the user to review and manually replay later.
Stashed changes are **never auto-applied**.

### Where it lives — the synced repo

```
.jade/stash/
  20260601T143022Z-a1b2c3d4.json
  20260601T150815Z-e5f6g7h8.json
```

Stash entries live **in the data repo** (`.jade/stash/`), not in device-local
storage. So they **sync between devices**: a stash created on the phone can be
resolved from the terminal or via the bot in Claude Code. Filename is
`<ISO8601-timestamp>-<short-uuid>.json` — timestamp first for chronological
sort, UUID for uniqueness within the same instant.

### Entry schema

```json
{
  "timestamp": "2026-06-01T14:30:22.123Z",
  "ancestors": {
    "calendar/config.json": "<full file content before local changes>",
    "calendar/events.json": "<full file content before local changes>"
  },
  "operations": [
    { "op": "json_patch", "path": "calendar/events.json", "patch": [ /* RFC 6902 */ ] },
    { "op": "json_patch", "path": "calendar/config.json", "patch": [ /* RFC 6902 */ ] }
  ]
}
```

- `timestamp` — when the local change was originally made (the queued batch's own
  ISO timestamp, millisecond-precision, reused verbatim).
- `ancestors` — path → full file content (string: JSON or markdown source) for
  **every file the batch touched** that existed at the baseline, as it was
  *before* the local changes; **keys sorted** for cross-client determinism. A
  file the batch *creates* has no ancestor and is omitted (its absence is the
  "before" state). Makes the entry **fully self-contained** — understanding what
  changed never requires querying git (deliberate, for the Postgres-substrate
  future). Note the ancestor is the pre-local-change baseline, not the live
  (already-edited-in-place) content and not the remote version — the client must
  retain the pristine baseline (the last-synced base) to produce it.
- `operations` — the **complete batch**, never a subset, stored as the **raw op
  objects verbatim** (the `{op, path, …}` wire format of DESIGN §4.2). The earlier
  `{type, path, payload}` sketch is superseded: the raw format is the one the
  mutation pipeline already speaks and that the conformance suite pins byte-for-
  byte, so web and `/jade` write **identical** entries (the Phase 6 cross-client
  goal). The file is serialised JS-canonically (`JSON.stringify(entry, null, 2) +
  "\n"`) for the same byte-identity reason.

### Full batches only

A stash entry always holds the **whole batch**, even if only one file in it
conflicted. If a batch touched A and B and only B conflicted, A's changes are
rolled back too and both go in the entry (`ancestors` and `operations` cover
both). A batch is atomic; a stash is an atomic unit of work that couldn't apply.

When multiple local batches are queued and a conflict is hit, **everything from
the first conflicting batch onward is stashed**; batches before it apply normally.
(E.g. batch 1 = files A,B; batch 2 = C,D; batch 3 = E,F; remote changed C → apply
batch 1, stash batches 2 and 3 whole.)

### Conflict flow (identical on both clients)

```
1. Local changes are committed locally.
2. Attempt push.
3. Push fails: remote has new commits.
4. Pull remote.
5. For each locally-changed file, check if it also changed remotely.
6. No conflicts → fast-forward / apply cleanly → push → done.
7. Any conflict →
   a. Write a stash entry to .jade/stash/ (full batch + ancestors).
   b. Reset ALL files the batch touched to the remote version.
   c. Commit the stash file + the resets.
   d. Push (succeeds — we now agree with remote).
   e. Warn the user.
```

- **`/jade` (real git):** `git fetch` → detect divergence → discard the local
  (unpushed) batch commit, including the operations-log line it appended
  (see §5) → `checkout <remote-ref>` for the touched files → write the stash
  entry → `git add` / `commit` / `push`. The bot is uninvolved; it just sees the
  post-resolution state.
- **Web app (REST):** same logic against the GitHub API; the stashed batch is
  simply dropped from the queue (never committed), and a commit containing the
  stash file + resets is pushed. Identical entry format and flow.

### Resolution

The user reviews each entry and either **replays it manually** or decides it's
moot. Two actions, both of which **delete the stash file** (a normal commit that
syncs to all devices):

- **Done** — the change was manually replayed.
- **Won't do** — the remote version is fine / the change is no longer relevant.

Surfaces:
- **Web app:** a "stashed changes" view (reached from the indicator or settings)
  lists entries with file path, timestamp, and a human-readable description
  derived from the op (e.g. *"Changed field 'Priority' from 3 to 1"*,
  *"Modified 5 lines"*), plus Done / Won't-do buttons.
- **`/jade`:** the bot manages the stash **only through dedicated tooling
  commands** (e.g. `jadelens stash list` / `jadelens stash resolve <id>`),
  **never by reading or writing `.jade/` directly** — the protected-path rule
  (DESIGN §4.2) stays absolute and the bot has no carve-out into `.jade/`. The
  bot can list, describe, and resolve entries on the user's behalf via those
  commands.

### Conflict indicator

The web app shows a small warning emoji at the top-right whenever `.jade/stash/`
is non-empty — persistent but non-intrusive, like an IDE's linter-error
indicator. It disappears when the stash is empty. Because the stash syncs, a
stash created on one device raises the indicator on the others.

### Repeated conflicts

If a file with unresolved stash entries conflicts again, new entries are appended
(their own timestamps and ancestors). A single file can accumulate several
entries across sync events. The stash grows until the user deals with it.

### Deferred (additive, not now)

- **Bot-assisted replay** — the bot reads an entry and applies its ops against the
  current file state automatically.
- **Auto-apply button** in the web app (needs conflict-aware patch application).
- **Visual diff** of ancestor vs. stashed change (JSON and markdown).
- **Ordering enforcement** — requiring chronological resolution. Most stashed
  changes are independent.

---

## 5. The operations log excludes stashed batches

The operations log (DESIGN §7.2) records the **evolution of the user's personal
data**, not the whole repo. Two consequences here:

- A **stashed (rolled-back) batch must not appear in the log** — it never reached
  ground truth. On `/jade`, the local commit that appended the batch's log line
  is discarded as part of stashing; on the web app, the dropped queue batch never
  committed its line. The **stash file in `.jade/stash/` is the sole record** of
  a rolled-back batch, living outside the log.
- **Stash machinery is not itself logged** — creating or resolving (deleting) a
  stash entry is repo bookkeeping, like the operations-log file itself, and does
  not produce a log entry.

---

## 6. Known problem (deferred): local post-push bookkeeping is not atomic with the remote ref update

In the web app's operation-queue model, only the final **ref update** mutates
remote state, so the **remote** side is effectively atomic — a failure partway
through the blob→tree→commit→ref sequence leaves only unreferenced (GC'd) objects
and nothing to roll back. (Conflict detection rides on this: the new commit's
parent is the known base SHA, so a non-fast-forward ref update is rejected when
remote has advanced — that rejection is the conflict signal.)

The gap is purely **local**. After the ref update succeeds on GitHub, the client
must update its IndexedDB bookkeeping — bump the base commit SHA and drop the
just-pushed batch from the queue. If the app is killed between GitHub moving the
ref and that write landing, the next sync sees "remote is ahead" by the client's
**own** commit, tries to re-push the still-queued batch (now with a stale parent),
the ref update is rejected, and the already-pushed change is **spuriously stashed
as a conflict** — a redundant entry, not data loss.

**Severity: low.** No information is lost; worst case is confusion from a phantom
stash entry the user dismisses.

**Possible solutions (none implemented; documenting only):**

1. **Single IndexedDB transaction on push success** — write the base-SHA bump and
   queue removal in one IDB transaction right after the ref update returns.
   Shrinks the window to milliseconds; doesn't fully close it (a crash can still
   land between the network ack and the IDB commit).
2. **Content/op dedupe on conflict** — before stashing, compare the remote change
   against the queued batch's intended result; if identical, recognize "the
   remote change *is* mine," drop the batch, don't stash. Fully closes the gap and
   also covers genuine same-edit-on-two-devices (the §3 dedupe).
3. **Client-tagged commits** — stamp each commit with a client-generated batch id;
   on remote-ahead, if the remote tip carries our pending batch's id, treat it as
   already-applied. Robust, but adds a tagging convention.

**Decision:** documented, not addressed. Revisit if phantom stashes appear in real
use; (2) is the natural fix and overlaps with already-planned dedupe work.
