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
import { getBranchHead, GitHubWriteError } from './githubWrite.js';
import { listStashPaths } from './stash.js';

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

/**
 * The current stash entries, parsed from the queue's synced base content.
 * Returns `[{path, entry}]` (entry is null if the file fails to parse), or `[]`
 * when the queue is uninitialised. Drives the indicator and the stash view.
 */
export async function getStashEntries(queue = getQueue()) {
  const state = await queue.getState();
  if (!state) return [];
  return listStashPaths(state.baseMap).map((path) => {
    let entry;
    try {
      entry = JSON.parse(state.baseMap.get(path));
    } catch {
      entry = null;
    }
    return { path, entry };
  });
}

/** The number of unpushed batches waiting in the queue (drives the
 * pending-sync indicator). 0 when the queue is empty or uninitialised. */
export async function getPendingCount(queue = getQueue()) {
  const state = await queue.getState();
  return state ? state.queue.length : 0;
}

/** Resolve (delete) a stash entry — both "Done" and "Won't do" route here. */
export async function resolveStashEntry(path, { pat }, queue = getQueue()) {
  return queue.resolveStash(path, { pat });
}

// Classify a write failure into a user-facing message. Auth problems are
// surfaced (the change is queued locally meanwhile); a plain network failure is
// silent (the app works offline and sync resumes — docs/sync-and-conflicts.md §2).
function classifyEditError(err) {
  if (err instanceof GitHubWriteError && err.status === 403) {
    return 'Your GitHub token can’t write to this repo (read-only, or missing “Contents: write”). The change is saved locally — update the PAT in Settings to sync.';
  }
  if (err instanceof GitHubWriteError && err.status === 401) {
    return 'GitHub rejected your token (expired or invalid). The change is saved locally — update the PAT in Settings to sync.';
  }
  if (err instanceof GitHubWriteError) {
    return `Could not sync the change (GitHub returned ${err.status}). It is saved locally and will retry.`;
  }
  return null; // network / unknown → silent; the queued change retries later.
}

/**
 * Commit a UI edit (docs/web/editing.md): apply + enqueue the batch, push
 * optimistically, and on a non-fast-forward fall back to a full sync (which
 * stashes the conflict). The local change applies regardless (local-first); a
 * failed push leaves it queued to retry.
 *
 * Ensures the queue is initialised for `repoUrl` first — `contentMap` seeds it
 * when needed (e.g. a reload straight into a file view, where FileBrowser never
 * mounted to init the queue).
 *
 * @returns {Promise<{workingMap, outcome: 'synced'|'stashed'|'pending', stashed: number, error: string|null}>}
 */
export async function commitEdit(
  { repoUrl, branch, pat, operations, commitMessage, contentMap },
  { queue = getQueue(), commit, fetchRemote, getHead } = {},
) {
  const state = await queue.getState();
  if (!state || state.repoUrl !== repoUrl) {
    if (!contentMap) throw new Error('Edit queue is not initialised for this repo');
    await initQueueFromRead(
      queue,
      { repoUrl, branch, pat, contentMap },
      getHead ? { getHead } : undefined,
    );
  }

  await queue.enqueue({ operations, commitMessage });

  const pushOpts = { pat, ...(commit ? { commit } : {}) };
  const syncOpts = { ...pushOpts, ...(fetchRemote ? { fetchRemote } : {}) };

  try {
    let result = await queue.push(pushOpts);
    if (result.conflicted) result = await queue.sync(syncOpts);
    const after = await queue.getState();
    return {
      workingMap: after?.workingMap ?? null,
      outcome: result.stashed ? 'stashed' : 'synced',
      stashed: result.stashed ?? 0,
      error: null,
    };
  } catch (err) {
    const after = await queue.getState();
    return {
      workingMap: after?.workingMap ?? null,
      outcome: 'pending',
      stashed: 0,
      error: classifyEditError(err),
    };
  }
}
