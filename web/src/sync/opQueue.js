// The web app's operation queue (Phase 1 of
// docs/mutation-sync-implementation-plan.md; design in docs/sync-and-conflicts.md
// §1 "operation-queue model").
//
// The browser has no local git, so a "local commit" is a queued operation batch
// applied on top of a known base commit. This module owns that queue state and
// the sequential build-and-push to GitHub. It is the integration seam:
//
//     mutation/run  →  OpQueue (this)  →  githubWrite.commitFileMap
//
// State (a single record behind a QueueStore — see queueStore.js):
//   repoUrl, branch         the data repo + branch we sync against
//   baseCommitSha           the last commit we are based on (push parent)
//   baseTreeSha             its tree (base_tree for the next commit)
//   baseMap   Map<path,str> pristine content at baseCommitSha — the ancestor
//                           source for stashing (Phase 2) and the replay base
//   queue     Batch[]       ordered unpushed batches; each Batch is
//                           { operations, commitMessage, timestamp }
//   workingMap Map<path,str> live content = baseMap + replay(queue)
//
// The per-batch `timestamp` is frozen at enqueue time and reused on replay so the
// operations-log line (which embeds it) is byte-identical whether produced now or
// re-derived at push time.

import { run } from '../mutation/index.js';
import { commitFileMap, PushConflictError, fetchRemoteState } from './githubWrite.js';
import { computeSyncPlan } from './conflicts.js';
import { buildStashEntry, stashFilename, serializeStashEntry } from './stash.js';

/** Replay a list of queued batches over a base map, returning the new map. */
function replayBatches(baseMap, batches) {
  let map = baseMap;
  for (const b of batches) {
    map = run(map, b.operations, b.commitMessage, { timestamp: b.timestamp });
  }
  return map;
}

const stashCommitMessage = (n) =>
  `Stash ${n} conflicting local change${n === 1 ? '' : 's'}`;

export class OpQueue {
  /** @param {{load: () => Promise<object|undefined>, save: (s: object) => Promise<void>}} store */
  constructor(store) {
    this.store = store;
  }

  /** The saved state, or undefined if the queue has never been initialised. */
  async getState() {
    return this.store.load();
  }

  async #requireState() {
    const state = await this.store.load();
    if (!state) throw new Error('OpQueue not initialised — call init() first');
    return state;
  }

  /**
   * Establish the synced baseline. Call after a fresh full read of the repo
   * (when the GitHub commit + tree SHAs and the content map are known). Resets
   * the queue and seeds workingMap from the base.
   *
   * @param {{repoUrl: string, branch: string, baseCommitSha: string,
   *          baseTreeSha: string, baseMap: Map<string,string>}} init
   */
  async init({ repoUrl, branch, baseCommitSha, baseTreeSha, baseMap }) {
    const state = {
      repoUrl,
      branch,
      baseCommitSha,
      baseTreeSha,
      baseMap: new Map(baseMap),
      queue: [],
      workingMap: new Map(baseMap),
    };
    await this.store.save(state);
    return state;
  }

  /**
   * Apply a batch locally (via the shared mutation pipeline) and enqueue it.
   * Throws (input untouched) if the batch is invalid — nothing is enqueued.
   *
   * @param {{operations: Array<object>, commitMessage: string, timestamp?: string}} batch
   * @returns {Promise<Map<string,string>>} the new working map (for re-render).
   */
  async enqueue({ operations, commitMessage, timestamp = new Date().toISOString() }) {
    const state = await this.#requireState();
    // run validates + applies + appends the ops-log line; it clones internally
    // and throws on any failure, so state is unchanged unless this succeeds.
    const working = run(state.workingMap, operations, commitMessage, { timestamp });
    state.queue.push({ operations, commitMessage, timestamp });
    state.workingMap = working;
    await this.store.save(state);
    return working;
  }

  /**
   * Push queued batches to GitHub one commit per batch, in order, advancing the
   * base after each success. Stops at the first non-fast-forward rejection (the
   * conflict signal) and reports it — Phase 2 turns that into a stash. Any other
   * error propagates with the base left at the last successful push.
   *
   * @param {{pat: string, commit?: typeof commitFileMap}} opts
   *   `commit` is injectable for tests; defaults to the real GitHub write.
   * @returns {Promise<{pushed: number, conflicted: boolean}>}
   */
  async push({ pat, commit = commitFileMap }) {
    let state = await this.getState();
    if (!state) return { pushed: 0, conflicted: false };

    let pushed = 0;
    while (state.queue.length > 0) {
      const batch = state.queue[0];
      const newMap = run(state.baseMap, batch.operations, batch.commitMessage, {
        timestamp: batch.timestamp,
      });

      let result;
      try {
        result = await commit(state.repoUrl, pat, {
          branch: state.branch,
          baseCommitSha: state.baseCommitSha,
          baseTreeSha: state.baseTreeSha,
          baseMap: state.baseMap,
          newMap,
          message: batch.commitMessage,
        });
      } catch (err) {
        if (err instanceof PushConflictError) return { pushed, conflicted: true };
        throw err;
      }

      state = await this.#advanceBase({
        baseCommitSha: result.commitSha,
        baseTreeSha: result.treeSha ?? state.baseTreeSha,
        baseMap: newMap,
      });
      pushed += 1;
    }
    return { pushed, conflicted: false };
  }

  /**
   * The full sync cycle (docs/sync-and-conflicts.md §2–§4): fetch remote → if it
   * advanced, rebase the queue onto it, stashing every batch from the first
   * conflict onward → push the kept batches. Unifies sync-on-focus (a pull that
   * may stash) and sync-on-save (push the queue, pulling+stashing on rejection).
   *
   * Ordering is chosen for no-data-loss: the stash bookkeeping commit lands on
   * remote *before* the stashed batches are dropped from persisted state, so a
   * failure after it leaves the stashed work safely recorded on the remote, and
   * a failure before it leaves the queue fully intact for a retry.
   *
   * @param {{pat: string, fetchRemote?: typeof fetchRemoteState, commit?: typeof commitFileMap}} opts
   * @returns {Promise<{pushed: number, stashed: number, conflicted: boolean}>}
   */
  async sync({ pat, fetchRemote = fetchRemoteState, commit = commitFileMap }) {
    const state = await this.getState();
    if (!state) return { pushed: 0, stashed: 0, conflicted: false };

    const remote = await fetchRemote(state.repoUrl, pat, state.branch);

    // A truncated remote tree is a partial view; treating missing files as
    // deletions would spuriously stash. Skip conflict processing and only push
    // what we can (the §6.1 truncation-guard concern, conservative side).
    if (remote.truncated) {
      const r = await this.push({ pat, commit });
      return { ...r, stashed: 0 };
    }

    // Remote unchanged → nothing to reconcile; just push the queue.
    if (remote.commitSha === state.baseCommitSha) {
      const r = await this.push({ pat, commit });
      return { ...r, stashed: 0 };
    }

    // Remote advanced → partition the queue at the first conflict.
    const plan = computeSyncPlan(state.queue, state.baseMap, remote.contentMap);

    let baseCommitSha = remote.commitSha;
    let baseTreeSha = remote.treeSha;
    let baseMap = new Map(remote.contentMap);
    let stashed = 0;

    if (plan.stashedBatches.length) {
      // Build the stash files from the PRISTINE base (state.baseMap), then commit
      // them onto remote first. A non-fast-forward here means the remote moved
      // again — bail with nothing persisted so the next sync retries cleanly.
      const stashMap = new Map(baseMap);
      for (const batch of plan.stashedBatches) {
        const entry = buildStashEntry(batch, state.baseMap);
        stashMap.set(stashFilename(batch.timestamp), serializeStashEntry(entry));
      }
      let result;
      try {
        result = await commit(state.repoUrl, pat, {
          branch: state.branch,
          baseCommitSha,
          baseTreeSha,
          baseMap,
          newMap: stashMap,
          message: stashCommitMessage(plan.stashedBatches.length),
        });
      } catch (err) {
        if (err instanceof PushConflictError) return { pushed: 0, stashed: 0, conflicted: true };
        throw err;
      }
      baseCommitSha = result.commitSha;
      baseTreeSha = result.treeSha ?? baseTreeSha;
      baseMap = stashMap;
      stashed = plan.stashedBatches.length;
    }

    // Persist the rebased baseline + kept queue, working content recomputed.
    await this.store.save({
      ...state,
      baseCommitSha,
      baseTreeSha,
      baseMap,
      queue: plan.keptQueue,
      workingMap: replayBatches(baseMap, plan.keptQueue),
    });

    const r = await this.push({ pat, commit });
    return { ...r, stashed };
  }

  /**
   * Resolve (delete) a stash entry. Both "Done" and "Won't do" map here — they
   * differ only in user intent (docs/sync-and-conflicts.md §4 "Resolution").
   *
   * Like the stash-creation commit, this is repo bookkeeping: it bypasses the
   * mutation pipeline (the `.jade/` path is protected) and appends no ops-log
   * line (§5 — stash machinery is not logged). The deletion commits directly on
   * the current synced base; any pending queued batches re-parent on the result.
   *
   * @param {string} stashPath - the `.jade/stash/<…>.json` path to remove.
   * @param {{pat: string, commit?: typeof commitFileMap}} opts
   * @returns {Promise<{removed: boolean}>} false if the entry was already gone.
   */
  async resolveStash(stashPath, { pat, commit = commitFileMap }) {
    const state = await this.#requireState();
    if (!state.baseMap.has(stashPath)) return { removed: false };

    const newMap = new Map(state.baseMap);
    newMap.delete(stashPath);

    const result = await commit(state.repoUrl, pat, {
      branch: state.branch,
      baseCommitSha: state.baseCommitSha,
      baseTreeSha: state.baseTreeSha,
      baseMap: state.baseMap,
      newMap,
      message: `Resolve stash entry ${stashPath.split('/').pop()}`,
    });

    const fresh = await this.#requireState();
    fresh.baseCommitSha = result.commitSha;
    fresh.baseTreeSha = result.treeSha ?? fresh.baseTreeSha;
    fresh.baseMap = newMap;
    fresh.workingMap = replayBatches(newMap, fresh.queue);
    await this.store.save(fresh);
    return { removed: true };
  }

  /**
   * Stash a batch that did NOT come from the queue — a stale editing-session
   * draft recovered on startup (Phase 5b). Unlike sync()'s stashing, the
   * ancestor content comes from the caller (`ancestorMap` = the draft's pristine
   * `beforeSnapshot`), not the queue base, because a draft was authored against
   * an older view. Writes the `.jade/stash/` file as a bookkeeping commit on the
   * current base (no ops-log line — §5) and advances; queued batches re-parent on
   * the result. Leaves no local queue entry — the draft lived only in IndexedDB.
   *
   * @param {{operations: Array<object>, commitMessage?: string, timestamp: string}} batch
   * @param {Map<string,string>} ancestorMap - pristine ancestor content for the
   *   files the batch touches (the stash entry's self-contained "before").
   * @param {{pat: string, commit?: typeof commitFileMap}} opts
   * @returns {Promise<{stashPath: string}>}
   */
  async stashDraftBatch(batch, ancestorMap, { pat, commit = commitFileMap }) {
    const state = await this.#requireState();
    const stashPath = stashFilename(batch.timestamp);
    const newMap = new Map(state.baseMap);
    newMap.set(stashPath, serializeStashEntry(buildStashEntry(batch, ancestorMap)));

    const result = await commit(state.repoUrl, pat, {
      branch: state.branch,
      baseCommitSha: state.baseCommitSha,
      baseTreeSha: state.baseTreeSha,
      baseMap: state.baseMap,
      newMap,
      message: stashCommitMessage(1),
    });

    const fresh = await this.#requireState();
    fresh.baseCommitSha = result.commitSha;
    fresh.baseTreeSha = result.treeSha ?? fresh.baseTreeSha;
    fresh.baseMap = newMap;
    fresh.workingMap = replayBatches(newMap, fresh.queue);
    await this.store.save(fresh);
    return { stashPath };
  }

  /**
   * Drop the front batch and move the base forward — in one store write, so the
   * SHA bump and queue removal land together (docs/sync-and-conflicts.md §6).
   */
  async #advanceBase({ baseCommitSha, baseTreeSha, baseMap }) {
    const state = await this.#requireState();
    state.queue.shift();
    state.baseCommitSha = baseCommitSha;
    state.baseTreeSha = baseTreeSha;
    state.baseMap = baseMap;
    await this.store.save(state);
    return state;
  }
}
