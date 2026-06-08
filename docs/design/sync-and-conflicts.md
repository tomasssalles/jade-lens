# Sync and conflicts

Local-first sync against a GitHub repo of state files, with a deliberately simple
conflict model whose one hard invariant is **no loss of information the user has
already provided**. This path is **built**.

Source of truth: [jadelens/sync.py](../../jadelens/sync.py),
[jadelens/stash.py](../../jadelens/stash.py) (Python / `/jade`),
[web/src/sync/](../../web/src/sync/) (web app). Related:
[mutation-pipeline.md](mutation-pipeline.md) (what produces a batch to sync),
[audit-and-correction.md](audit-and-correction.md) (the log, which excludes stashed
batches).

> This doc is the design-level view; the fine-grained step-by-step mechanism
> (queue model, sync-on-focus/save flows, entry schema, the non-atomic-bookkeeping
> edge) lives in the companion [sync-mechanism.md](sync-mechanism.md).

## Local-first

The UI reads and writes only **local state** and never blocks on the network. Sync
runs in the background and emits events the UI subscribes to.

## Triggers and surfacing

- **Web app:** pull **on focus** (foreground / tab activation — usually a fast
  no-op); push **on save** (a micro-edit, an editing-session save, a form submit).
- **`/jade`:** sync **on every interaction** — pull before processing, push after.
  Deliberately aggressive; throttle later only if it causes rate-limit/perf
  problems. The SKILL.md tells the bot syncing is automatic — it must not
  pull/push or offer to.

A non-intrusive status indicator shows sync state (last-synced, in-progress,
error). Conflicts surface **non-modally**: the common case (local is an ancestor
of remote) is a quiet fast-forward; a real same-file conflict raises a persistent,
unintrusive indicator for stashed changes, never a blocking modal.

## Remote storage substrate

**Decided for v1: a GitHub repo of state files.** Each atomic change is a commit.
Three candidates were weighed (GitHub repo of files; GitHub repo with fine-grained
commits as a de-facto patch log; Firebase/Supabase free tier); the repo-of-files
won on $0 cost, existing auth, free version control, and raw inspectability.

- **Web app** has no local git: it commits via the GitHub Git Data API using an
  **operation-queue** model — a "local commit" is a queued op-batch + resulting
  content + the base commit SHA, persisted in IndexedDB. (GitHub's git
  smart-HTTP isn't CORS-reachable from a Pages origin without a proxy we won't add
  for private data.)
- **`/jade`** uses a real local clone.

A later move to Postgres for query-heavy data ([versioning.md](versioning.md),
[security-and-trust.md](security-and-trust.md)) is anticipated, so the sync/conflict
design is kept substrate-agnostic — no dependence on git's merge; self-contained
stash entries — so it survives that move.

## Conflict detection

Single user across multiple non-simultaneous devices, so conflicts are **rare**;
the handling may be manual/inconvenient, but must never drop user data.

- **File-level detection.** A conflict is the *same file* changed both locally and
  remotely since the last sync. Different files on different devices both apply (no
  conflict — the common case). There is **no within-file merge** (not at JSON-path,
  array-element, or text-line level): it needs data semantics, is fragile, and
  same-file conflicts are rare. Structural ops count as changes — delete/move of X
  means X changed; a directory op means every file under it (recursive) changed;
  any file touched on both sides conflicts regardless of op kind.
- **Pushed version wins.** Whoever syncs first is ground truth and is never rolled
  back (a successfully pushed change must not vanish). The second device's
  conflicting batch yields.

## The stash

The losing batch is saved to `.jade/stash/<ts>-<uuid>.json` in the (synced) repo —
the **full batch** plus a self-contained ancestor snapshot — and the files it
touched are reset to remote. So nothing is lost: the user reviews stashed entries
and marks each **done** (replayed manually) or **won't do**; resolving deletes the
entry. A persistent, non-intrusive indicator shows while the stash is non-empty.

The same flow and entry format run on both clients. On `/jade` the bot manages the
stash only via dedicated tooling (`jadelens stash <repo> --list | --resolve <id>`)
— never touching `.jade/` directly (it's a protected path —
[mutation-pipeline.md](mutation-pipeline.md)).

Smart merging, bot-assisted replay, and auto-apply are deferred.

## The operations log excludes stashed batches

A rolled-back (stashed) batch never appears in the operations log — the stash entry
is its sole record. This keeps the log a linear series of changes that actually
brought the data to its current state ([audit-and-correction.md](audit-and-correction.md)).

## Known edge (deferred)

The web app's post-push bookkeeping (advancing the local base SHA after a
successful push) is not atomic with the remote ref update — a crash in the window
can leave local state briefly inconsistent. Tracked with the full analysis in the
legacy mechanism doc above; deferred as low-probability and self-healing on the
next sync.
