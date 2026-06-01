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
import { commitFileMap, PushConflictError } from './githubWrite.js';

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
