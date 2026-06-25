# Migration checkpoints: commit-trailers instead of tags

## Why

`jadelens migrate` records migration progress with two git **tags** per step
(`vN-v(N+1)-migration-start` / `-end`), created locally and pushed. The claude.ai
git relay — the primary `/jade` environment — accepts branch pushes but **403s
`refs/tags/*`**. Two failures result:

1. **The push fails.** A tag-based checkpoint can't reach the remote at all.
2. **The failure is silent + unrecoverable.** Phase B gates the start-tag push
   behind `_tag_exists` (a *local* check). The first call creates the tag locally,
   the push 403s and `sys.exit`s; the bot retries `jadelens migrate`, which now
   sees the local tag and takes the resume branch — **never re-attempting the
   push**. The migration proceeds with no remote checkpoint, then dies at finalize
   (which always re-pushes) with a 403.

## Fix

Record checkpoints as **commit-message trailers on `main`** instead of tags:

- A checkpoint is an empty commit (for `start`) or the version-bump commit (for
  `end`) carrying a `Jade-Checkpoint: vN-v(N+1)-(start|end)` trailer.
- It rides on `main`, so it travels with the ordinary **branch push** the relay
  allows — no `refs/tags/*`, no `--tags`.
- "Is the checkpoint established?" becomes "is there a commit carrying its trailer
  in `main`'s history?" — and because Phase B **always** ensures `main` is pushed
  (not gated on local checkpoint existence), a previously-failed push self-heals on
  the next call. That directly kills bug #2.

Key property that makes this correct (and why a SHA-in-a-state-file doesn't work):
the checkpoint must live *outside* the rolled-back content. A commit marker is the
rollback **target** itself — you `reset --hard` *to* it, never *past* it — so it is
never destroyed by its own rollback, while still being pushable on a branch.

Design reference: `docs/design/versioning.md` (Migrations section).

---

## Steps

- [ ] **1. Checkpoint primitives.** Add to `migrate.py`: `_CHECKPOINT_TRAILER`,
  `_checkpoint_sha(repo, marker)` (most recent HEAD-reachable commit with that
  trailer, or `None`), `_checkpoint_exists`, `_create_checkpoint_commit` (empty
  commit carrying the trailer). Additive — old code untouched. Unit tests for
  create/detect/absent.

- [ ] **2. Convert the state machine.** Rewrite `_push` (drop `--tags` → push
  `main` only), `_phase_a` (verify start checkpoint; bump `.jade/version` carrying
  the `end` trailer, or ensure the end checkpoint if already bumped), and
  `_phase_b` (detect start checkpoint; fresh-start creates it, crash-recovery
  `reset --hard` to it, clean resume; **always `_push` `main`** afterward). Remove
  `_tag_exists`. Rewrite `test_migrate.py` for checkpoints, **including a
  regression test** that simulates a failed start-push and asserts the next call
  re-pushes it to the remote.

- [ ] **3. Update the design doc.** Rewrite the `versioning.md` migration mechanics,
  the data-repo "tags" table (→ checkpoints), and the worked execution-flow example
  to describe commit-trailer checkpoints and branch-only pushes.

- [ ] **4. e2e harness cleanup.** Remove the now-obsolete migration-tag clearing
  from `tests/e2e/materialize.py` (`MIGRATION_TAG_PATTERN` + the delete loop) —
  the force-push of `main` already resets checkpoints. Update the matching
  description in `docs/design/e2e-testing.md`.

- [ ] **5. Fix release (CLI only).** Bump `__version__` → `v0.2.2`, finalize the
  CLI changelog (`unreleased.md` → `v0.2.2.md`), fast-forward `main`, push, and
  prepare the `Release tags` dispatch (`component: cli`).
