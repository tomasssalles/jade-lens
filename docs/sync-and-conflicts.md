# Sync & conflicts — design notes

> **Status: design in progress.** This file is a holding place for decisions and
> deferred problems coming out of the data-mutation / sync / conflict discussion.
> It is intentionally narrow right now — it captures only a deferred known
> problem. The full sync / conflict / stash design will be folded into
> `DESIGN.md` (§8) and/or a fuller doc once the discussion is finalized.

## Context (just enough for the note below)

The web app creates commits against the GitHub data repo via the **GitHub Git
Data API** (the "operation-queue" substrate: local edits are queued op-batches
applied on top of a known base commit SHA, then pushed). A push is a sequence of
calls: create blob(s) → create tree → create commit → update ref (`PATCH`).

Only the final **ref update** mutates remote state. Blobs/trees/commits created
by the earlier calls are unreferenced git objects until the ref points at them —
invisible to other clients and garbage-collected if abandoned. So the **remote**
side is effectively atomic: a failure partway through leaves nothing to roll
back, and the client simply retries the whole sequence. (Conflict detection
rides on this too: the new commit's parent is the known base SHA, so a
non-fast-forward ref update is rejected when remote has advanced — that rejection
is the conflict signal.)

## Known problem (deferred): local post-push bookkeeping is not atomic with the remote ref update

The gap is purely **local**. After the ref update succeeds on GitHub, the client
must update its own IndexedDB bookkeeping — bump the stored base commit SHA and
drop the just-pushed batch from the queue. If the app is killed in the window
between GitHub moving the ref and that IndexedDB write landing, the next sync
sees "remote is ahead" by the client's **own** commit. It then tries to re-push
the still-queued batch (now with a stale parent), the ref update is rejected as
non-fast-forward, and the already-pushed change is **spuriously stashed as a
conflict** — a redundant stash entry, not data loss.

**Severity: low.** No information is lost — the change is safely on remote; the
spurious stash is just a duplicate the user has to dismiss. Worst case is
confusion from a phantom stash entry.

**Possible solutions (none implemented; documenting only):**

1. **Single IndexedDB transaction on push success.** Write the base-SHA bump and
   the queue removal in one IDB transaction immediately after the ref update
   returns. Shrinks the window to milliseconds but doesn't fully close it — a
   crash can still land between the network ack and the IDB commit.
2. **Content/op dedupe on conflict.** Before stashing, compare the remote change
   against the queued batch's intended result; if identical, recognize "the
   remote change *is* mine," drop the queued batch, and don't stash. Fully closes
   this gap and also covers the genuine same-edit-on-two-devices case. This is
   the same "identical-op dedupe" deferred in the mutation discussion.
3. **Client-tagged commits.** Stamp each commit with a client-generated batch id
   (commit-message trailer or similar); on remote-ahead, if the remote tip
   carries our pending batch's id, treat it as already-applied rather than
   conflicting. Robust, but adds a tagging convention.

**Decision:** documented, not addressed. Revisit if phantom stashes show up in
real use; solution (2) is the natural fix and overlaps with already-planned
dedupe work.
