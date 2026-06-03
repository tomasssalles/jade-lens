// Sync controller — the seam between the app (React) and the operation queue.
// Owns the process-wide queue singleton and the read-path → queue.init() wiring
// that establishes the synced baseline (Phase 2 of
// docs/mutation-sync-implementation-plan.md; the §6.1 queue↔repoCache contract).
//
// Once the queue is initialised, its workingMap is the single render authority
// (§6.1): the open file (Phase 3) AND the file-browser tree (Phase 5d) read
// through it, so local edits and sync-on-focus pulls show immediately. repoCache
// demotes to the cold-start / no-flicker preload and the structural source for
// files the queue never tracks (e.g. blobs over the fetch-size cap).

import { OpQueue } from './opQueue.js';
import { createIdbQueueStore } from './idbQueueStore.js';
import { getBranchHead, GitHubWriteError } from './githubWrite.js';
import { listStashPaths } from './stash.js';
import { createIdbDraftStore } from '../edit/idbDraftStore.js';
import { reconcileDraft } from '../edit/draftReconcile.js';

let _queue = null;
let _draftStore = null;

/** The process-wide OpQueue, lazily bound to the IndexedDB store. */
export function getQueue() {
  if (!_queue) _queue = new OpQueue(createIdbQueueStore());
  return _queue;
}

/** The process-wide draft store, lazily bound to the IndexedDB store. */
export function getDraftStore() {
  if (!_draftStore) _draftStore = createIdbDraftStore();
  return _draftStore;
}

/**
 * Reconcile persisted editing-session drafts against current content on startup
 * (docs/web/editing.md "On app startup"). For each draft: restorable drafts are
 * left in place (the editor reopens them — wired in 5c); no-op drafts are
 * dropped; drafts whose file changed underneath are stashed (preserving the
 * work) and then removed. Requires an initialised queue — without one there's no
 * base to stash onto, so drafts are kept untouched for a later pass.
 *
 * @param {{getCurrentContent: (path: string) => Promise<string|undefined>, pat: string}} args
 * @returns {Promise<{restorable: object[], stashed: Array<{id: string, stashPath: string}>, discarded: string[], unsupported: string[], skipped?: boolean}>}
 */
export async function reconcileDrafts(
  { getCurrentContent, pat },
  { queue = getQueue(), store = getDraftStore(), commit } = {},
) {
  const result = { restorable: [], stashed: [], discarded: [], unsupported: [] };
  if (!(await queue.getState())) return { ...result, skipped: true };

  const commitOpt = commit ? { commit } : {};
  for (const draft of await store.getAll()) {
    const decision = reconcileDraft(draft, await getCurrentContent(draft.filePath));
    if (decision.action === 'restore') {
      result.restorable.push(draft);
    } else if (decision.action === 'discard') {
      await store.delete(draft.id);
      result.discarded.push(draft.id);
    } else if (decision.action === 'stash') {
      const { stashPath } = await queue.stashDraftBatch(decision.batch, decision.ancestorMap, {
        pat,
        ...commitOpt,
      });
      await store.delete(draft.id);
      result.stashed.push({ id: draft.id, stashPath });
    } else {
      result.unsupported.push(draft.id);
    }
  }
  return result;
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
  if (existing && existing.repoUrl === repoUrl && existing.baseCommitSha === head.commitSha) {
    // The queue is already at the remote head — keep its working content (which
    // reflects any just-synced edits) instead of resetting it from a re-read,
    // which may be a staler view of the same commit (the read caches lag).
    return true;
  }
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
 * The queue's current working content for a path, or undefined if the queue
 * isn't initialised (for this repo) or doesn't hold the path. The working map
 * is the single source of truth for what to display — it carries local edits
 * (pending or synced) and survives reloads (persisted in IndexedDB), so the file
 * view reads through it rather than the read caches, which a background refresh
 * can transiently clobber.
 */
export async function getWorkingContent(path, { repoUrl } = {}, queue = getQueue()) {
  const state = await queue.getState();
  if (!state) return undefined;
  if (repoUrl && state.repoUrl !== repoUrl) return undefined;
  return state.workingMap?.get(path);
}

/**
 * The file-browser tree, sourced from the queue's workingMap — the render
 * authority once the queue is initialised (§6.1, Phase 5d). Returns one
 * `{path, type: 'blob'}` per working-map path (FileTree infers directories) plus
 * the `contentMap` for opening files without a network round-trip, or `null`
 * when the queue isn't initialised for `repoUrl` (the caller then falls back to
 * the read cache — e.g. a truncated tree never inits the queue).
 *
 * Note: workingMap holds only the files the read path fetched, so blobs over the
 * size cap (omitted by fetchBlobs) won't appear here; the caller preserves those
 * from the structural read cache.
 */
export async function getWorkingTree({ repoUrl } = {}, queue = getQueue()) {
  const state = await queue.getState();
  if (!state) return null;
  if (repoUrl && state.repoUrl !== repoUrl) return null;
  const contentMap = state.workingMap;
  const items = [...contentMap.keys()].map((path) => ({ path, type: 'blob' }));
  return { items, contentMap };
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

// Push the queue (push → on non-fast-forward, full sync that stashes), then
// classify the outcome. Shared by commitEdit and syncPending so both report the
// same {outcome, error} for the same failure.
async function flushQueue(queue, { pat, commit, fetchRemote }) {
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
  return flushQueue(queue, { pat, commit, fetchRemote });
}

/**
 * Retry pushing already-queued work (no new edit) — the reload retry. Returns
 * the same classified shape as commitEdit, plus `hadPending` (false when the
 * queue was empty / for another repo, so the caller can stay silent).
 */
export async function syncPending({ repoUrl, pat }, { queue = getQueue(), commit, fetchRemote } = {}) {
  const state = await queue.getState();
  if (!state || state.repoUrl !== repoUrl || state.queue.length === 0) {
    return { workingMap: state?.workingMap ?? null, outcome: 'synced', stashed: 0, error: null, hadPending: false };
  }
  return { ...(await flushQueue(queue, { pat, commit, fetchRemote })), hadPending: true };
}
