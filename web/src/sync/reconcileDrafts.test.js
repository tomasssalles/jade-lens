// Covers OpQueue.stashDraftBatch (the draft-conflict stash commit) and the
// syncController.reconcileDrafts orchestration, against memory stores and an
// injected commit fn (no IndexedDB, no network).
import { describe, it, expect, vi } from 'vitest';
import { OpQueue } from './opQueue.js';
import { createMemoryQueueStore } from './queueStore.js';
import { reconcileDrafts } from './syncController.js';
import { createMemoryDraftStore, buildDraft } from '../edit/draftStore.js';
import { listStashPaths } from './stash.js';

const VERSION = 'v0.1.0';

function baseMap(extra = {}) {
  return new Map([['.jade/version', VERSION], ...Object.entries(extra)]);
}

async function freshQueue(base = baseMap({ 'notes.md': 'a\nb\nc\n' })) {
  const q = new OpQueue(createMemoryQueueStore());
  await q.init({
    repoUrl: 'https://github.com/o/r',
    branch: 'main',
    baseCommitSha: 'base000',
    baseTreeSha: 'tree000',
    baseMap: base,
  });
  return q;
}

function recordingCommit() {
  const calls = [];
  let n = 0;
  const commit = vi.fn(async (repoUrl, pat, args) => {
    calls.push(args);
    n += 1;
    return { commitSha: `commit${n}`, treeSha: `tree${n}`, changed: true };
  });
  return { commit, calls };
}

describe('OpQueue.stashDraftBatch', () => {
  it('writes a self-contained stash file on the base and advances', async () => {
    const q = await freshQueue();
    const { commit, calls } = recordingCommit();
    const batch = {
      operations: [{ op: 'unified_diff', path: 'notes.md', diff: '@@ -2,1 +2,1 @@\n-b\n+B\n' }],
      commitMessage: 'Manual edit — notes.md',
      timestamp: '2026-06-01T00:00:00.000Z',
    };
    const ancestorMap = new Map([['notes.md', 'a\nb\nc\n']]);

    const { stashPath } = await q.stashDraftBatch(batch, ancestorMap, { pat: 'p', commit });

    // The stash file landed in the committed map and the entry is self-contained.
    const committed = calls[0].newMap;
    expect(committed.has(stashPath)).toBe(true);
    const entry = JSON.parse(committed.get(stashPath));
    expect(entry.ancestors).toEqual({ 'notes.md': 'a\nb\nc\n' });
    expect(entry.operations).toEqual(batch.operations);

    // Base advanced; the stash file is now part of the synced base.
    const state = await q.getState();
    expect(state.baseCommitSha).toBe('commit1');
    expect(listStashPaths(state.baseMap)).toEqual([stashPath]);

    // No ops-log line was written (stash machinery is unlogged, §5).
    const logPaths = [...committed.keys()].filter((p) => p.includes('operations-log'));
    expect(logPaths).toEqual([]);
  });
});

describe('reconcileDrafts', () => {
  const getContent = (q) => async (path) => (await q.getState()).workingMap.get(path);

  it('skips entirely when the queue is uninitialised', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    const store = createMemoryDraftStore();
    await store.put(buildDraft({ filePath: 'notes.md', beforeSnapshot: 'x', editorContent: 'y' }));
    const res = await reconcileDrafts(
      { getCurrentContent: async () => undefined, pat: 'p' },
      { queue: q, store },
    );
    expect(res.skipped).toBe(true);
    expect(await store.getAll()).toHaveLength(1); // untouched
  });

  it('restores, discards, and stashes drafts by their reconciliation outcome', async () => {
    const q = await freshQueue();
    const { commit } = recordingCommit();
    const store = createMemoryDraftStore();

    // restore: file unchanged since the session began
    const keep = buildDraft({ filePath: 'notes.md', beforeSnapshot: 'a\nb\nc\n', editorContent: 'a\nB\nc\n' });
    // discard: nothing was edited
    const noop = buildDraft({ filePath: 'other.md', beforeSnapshot: 'same\n', editorContent: 'same\n' });
    // stash: file moved on underneath (its beforeSnapshot ≠ current base content)
    const stale = buildDraft({
      filePath: 'gone.md',
      beforeSnapshot: 'old\n',
      editorContent: 'mine\n',
      timestamp: '2026-06-02T00:00:00.000Z',
    });
    await store.put(keep);
    await store.put(noop);
    await store.put(stale);

    const res = await reconcileDrafts(
      { getCurrentContent: getContent(q), pat: 'p' },
      { queue: q, store, commit },
    );

    expect(res.restorable.map((d) => d.id)).toEqual([keep.id]);
    expect(res.discarded).toEqual([noop.id]);
    expect(res.stashed).toHaveLength(1);
    expect(res.stashed[0].id).toBe(stale.id);

    // Restorable draft kept; discarded + stashed drafts removed.
    const remaining = (await store.getAll()).map((d) => d.id);
    expect(remaining).toEqual([keep.id]);

    // The stashed edit is recoverable from the synced base.
    const state = await q.getState();
    expect(listStashPaths(state.baseMap)).toEqual([res.stashed[0].stashPath]);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
