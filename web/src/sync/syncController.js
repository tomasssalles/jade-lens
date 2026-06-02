// Sync controller — the seam between the app (React) and the operation queue.
// Owns the process-wide queue singleton and the read-path → queue.init() wiring
// that establishes the synced baseline (Phase 2 of
// docs/mutation-sync-implementation-plan.md; the §6.1 queue↔repoCache contract).
//
// Phase 2 scope: initialise the queue from a completed full read so the baseline
// (commit/tree SHAs + pristine content) is ready for editing. The render
// authority stays with repoCache while the app is read-only; flipping rendering
// to the queue's workingMap and hooking sync to the window focus event happen in
// Phase 3, where editing goes live and the two content layers are reconciled.

import { OpQueue } from './opQueue.js';
import { createIdbQueueStore } from './idbQueueStore.js';
import { getBranchHead } from './githubWrite.js';

let _queue = null;

/** The process-wide OpQueue, lazily bound to the IndexedDB store. */
export function getQueue() {
  if (!_queue) _queue = new OpQueue(createIdbQueueStore());
  return _queue;
}

/**
 * Establish (or re-establish) the queue's synced baseline from a completed full
 * read of the repo. Fetches the head commit/tree SHAs the queue needs (the read
 * path only has tree items, no commit SHA — the §6.1 "SHA gap").
 *
 * ⚠️ Refuses to init from a TRUNCATED tree (§6.1): a partial content map would
 * make computeTreeChanges read missing-because-truncated files as deletions and
 * silently wipe them on the next push. Returns false without initialising.
 *
 * Re-init is skipped when the queue already tracks this repo and has unpushed
 * work, so an incidental re-read never clobbers a pending edit queue.
 *
 * @param {OpQueue} queue
 * @param {{repoUrl, branch, pat, contentMap: Map<string,string>, truncated?: boolean}} read
 * @param {{getHead?: typeof getBranchHead}} [deps]
 * @returns {Promise<boolean>} whether the queue is now initialised for this repo.
 */
export async function initQueueFromRead(
  queue,
  { repoUrl, branch, pat, contentMap, truncated = false },
  { getHead = getBranchHead } = {},
) {
  if (truncated) return false;

  const existing = await queue.getState();
  if (existing && existing.repoUrl === repoUrl && existing.queue.length > 0) {
    // Pending local work against the same repo — don't reset the baseline.
    return true;
  }

  const head = await getHead(repoUrl, pat, branch);
  await queue.init({
    repoUrl,
    branch: head.branch,
    baseCommitSha: head.commitSha,
    baseTreeSha: head.treeSha,
    baseMap: contentMap,
  });
  return true;
}
