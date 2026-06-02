import { describe, it, expect, vi } from 'vitest';
import { OpQueue } from './opQueue.js';
import { createMemoryQueueStore } from './queueStore.js';
import { PushConflictError } from './githubWrite.js';
import { computeSyncPlan } from './conflicts.js';

const VERSION = 'v0.1.0';
const LOG_PATH = `.jade/operations-log/${VERSION}.jsonl`;

function baseMap(extra = {}) {
  return new Map([['.jade/version', VERSION], ...Object.entries(extra)]);
}

async function freshQueue(base = baseMap()) {
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

function createBatch(path, content, ts) {
  return { operations: [{ op: 'create_file', path, content }], commitMessage: `add ${path}`, timestamp: ts };
}

// A commit() stub that succeeds, recording every call and minting SHAs. `failOn`
// (1-based call index) throws PushConflictError for that call.
function recordingCommit({ failOn = 0 } = {}) {
  const calls = [];
  let n = 0;
  const commit = vi.fn(async (repoUrl, pat, args) => {
    n += 1;
    if (n === failOn) throw new PushConflictError();
    calls.push({ args });
    return { commitSha: `commit${n}`, treeSha: `tree${n}`, changed: true };
  });
  return { commit, calls };
}

// fetchRemote stub.
const remoteOf = (overrides) => async () => ({
  branch: 'main',
  commitSha: 'base000',
  treeSha: 'tree000',
  contentMap: baseMap(),
  truncated: false,
  ...overrides,
});

const stashFilesIn = (map) =>
  [...map.keys()].filter((p) => p.startsWith('.jade/stash/') && p.endsWith('.json'));

describe('computeSyncPlan', () => {
  const b = (...ops) => ({ operations: ops });

  it('keeps the whole queue when nothing conflicts', () => {
    const base = baseMap({ a: '1' });
    const remote = baseMap({ a: '1', remoteOnly: 'x' });
    const queue = [b({ op: 'json_patch', path: 'a' })];
    const plan = computeSyncPlan(queue, base, remote);
    expect(plan.conflictIndex).toBe(-1);
    expect(plan.keptQueue).toBe(queue);
    expect(plan.stashedBatches).toEqual([]);
  });

  it('partitions at the first conflicting batch', () => {
    const base = baseMap({ a: '1', shared: '1' });
    const remote = baseMap({ a: '1', shared: '2' }); // remote changed shared
    const queue = [
      b({ op: 'json_patch', path: 'a' }),
      b({ op: 'json_patch', path: 'shared' }),
      b({ op: 'json_patch', path: 'c' }),
    ];
    const plan = computeSyncPlan(queue, base, remote);
    expect(plan.conflictIndex).toBe(1);
    expect(plan.keptQueue).toHaveLength(1);
    expect(plan.stashedBatches).toHaveLength(2);
  });
});

describe('OpQueue.sync — no remote change', () => {
  it('just pushes the queue', async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch('a.md', 'A\n', '2026-06-01T00:00:00.000Z'));
    const { commit, calls } = recordingCommit();

    const res = await q.sync({ pat: 't', fetchRemote: remoteOf({ commitSha: 'base000' }), commit });

    expect(res).toEqual({ pushed: 1, stashed: 0, conflicted: false });
    expect(calls).toHaveLength(1);
    expect((await q.getState()).queue).toHaveLength(0);
  });
});

describe('OpQueue.sync — remote advanced, no conflict (fast-forward rebase)', () => {
  it('adopts remote as base and pushes the local batch on top', async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch('local.md', 'L\n', '2026-06-01T00:00:00.000Z'));
    const remoteMap = baseMap({ 'remote.md': 'R\n' });
    const { commit, calls } = recordingCommit();

    const res = await q.sync({
      pat: 't',
      fetchRemote: remoteOf({ commitSha: 'remoteC', treeSha: 'remoteT', contentMap: remoteMap }),
      commit,
    });

    expect(res).toEqual({ pushed: 1, stashed: 0, conflicted: false });
    // The push is parented on the remote tip, not the stale local base.
    expect(calls[0].args.baseCommitSha).toBe('remoteC');
    expect(calls[0].args.baseTreeSha).toBe('remoteT');
    // The pushed map carries both the remote file and the local addition.
    expect(calls[0].args.newMap.get('remote.md')).toBe('R\n');
    expect(calls[0].args.newMap.get('local.md')).toBe('L\n');

    const state = await q.getState();
    expect(state.queue).toHaveLength(0);
    expect(state.workingMap.get('remote.md')).toBe('R\n');
    expect(state.workingMap.get('local.md')).toBe('L\n');
  });
});

describe('OpQueue.sync — conflict → stash', () => {
  async function setupConflict() {
    const q = await freshQueue(baseMap({ 'shared.md': 'base\n' }));
    await q.enqueue(createBatch('a.md', 'A\n', '2026-06-01T00:00:01.000Z')); // batch1, no conflict
    await q.enqueue({
      operations: [{ op: 'delete_path', path: 'shared.md' }],
      commitMessage: 'delete shared',
      timestamp: '2026-06-01T00:00:02.000Z',
    }); // batch2 — conflicts with remote's edit to shared.md
    await q.enqueue(createBatch('c.md', 'C\n', '2026-06-01T00:00:03.000Z')); // batch3
    const remoteMap = baseMap({ 'shared.md': 'remote-edited\n' });
    return { q, remoteMap };
  }

  it('stashes from the first conflict onward and pushes only the kept batch', async () => {
    const { q, remoteMap } = await setupConflict();
    const { commit, calls } = recordingCommit();

    const res = await q.sync({
      pat: 't',
      fetchRemote: remoteOf({ commitSha: 'remoteC', treeSha: 'remoteT', contentMap: remoteMap }),
      commit,
    });

    expect(res).toEqual({ pushed: 1, stashed: 2, conflicted: false });
    // Two commits: [0] the stash bookkeeping commit, [1] the kept batch1 push.
    expect(calls).toHaveLength(2);

    const stashCommit = calls[0].args;
    const stashFiles = stashFilesIn(stashCommit.newMap);
    expect(stashFiles).toHaveLength(2);
    // The stash commit must NOT add a data file or an ops-log line.
    expect(stashCommit.newMap.has('a.md')).toBe(false);
    expect(stashCommit.newMap.has('c.md')).toBe(false);
    expect(stashCommit.newMap.get(LOG_PATH)).toBeUndefined();

    // The kept push carries batch1 and exactly one ops-log line.
    const keptCommit = calls[1].args;
    expect(keptCommit.newMap.get('a.md')).toBe('A\n');
    expect(keptCommit.newMap.get(LOG_PATH).trimEnd().split('\n')).toHaveLength(1);
  });

  it('writes a self-contained stash entry with the pristine ancestor', async () => {
    const { q, remoteMap } = await setupConflict();
    const { commit, calls } = recordingCommit();
    await q.sync({
      pat: 't',
      fetchRemote: remoteOf({ commitSha: 'remoteC', treeSha: 'remoteT', contentMap: remoteMap }),
      commit,
    });

    const stashMap = calls[0].args.newMap;
    const entries = stashFilesIn(stashMap).map((p) => JSON.parse(stashMap.get(p)));
    const deleteEntry = entries.find((e) => e.operations[0].op === 'delete_path');
    // Ancestor is the PRISTINE base content, not the remote-edited version.
    expect(deleteEntry.ancestors).toEqual({ 'shared.md': 'base\n' });
    expect(deleteEntry.operations).toEqual([{ op: 'delete_path', path: 'shared.md' }]);
  });

  it('leaves the remote-won file and drops the stashed local edits from working content', async () => {
    const { q, remoteMap } = await setupConflict();
    const { commit } = recordingCommit();
    await q.sync({
      pat: 't',
      fetchRemote: remoteOf({ commitSha: 'remoteC', treeSha: 'remoteT', contentMap: remoteMap }),
      commit,
    });

    const state = await q.getState();
    expect(state.queue).toHaveLength(0);
    expect(state.workingMap.get('shared.md')).toBe('remote-edited\n'); // remote won
    expect(state.workingMap.get('a.md')).toBe('A\n'); // kept batch applied
    expect(state.workingMap.has('c.md')).toBe(false); // stashed batch dropped
    expect(stashFilesIn(state.workingMap)).toHaveLength(2); // stash files present
  });

  it('bails without persisting if the stash commit hits a race (no data loss)', async () => {
    const { q, remoteMap } = await setupConflict();
    const before = await q.getState();
    const { commit } = recordingCommit({ failOn: 1 }); // the stash commit 422s

    const res = await q.sync({
      pat: 't',
      fetchRemote: remoteOf({ commitSha: 'remoteC', treeSha: 'remoteT', contentMap: remoteMap }),
      commit,
    });

    expect(res).toEqual({ pushed: 0, stashed: 0, conflicted: true });
    const after = await q.getState();
    expect(after.queue).toHaveLength(before.queue.length); // all 3 still queued
    expect(after.baseCommitSha).toBe('base000'); // base untouched
  });
});

describe('OpQueue.resolveStash', () => {
  const STASH = '.jade/stash/20260601T140000Z-aaaa.json';

  it('commits the stash-file deletion and drops it from base + working', async () => {
    const q = await freshQueue(baseMap({ [STASH]: '{}\n', 'notes.md': 'x\n' }));
    const { commit, calls } = recordingCommit();

    const res = await q.resolveStash(STASH, { pat: 't', commit });

    expect(res).toEqual({ removed: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].args.newMap.has(STASH)).toBe(false);
    expect(calls[0].args.newMap.has(LOG_PATH)).toBe(false); // resolution is not logged
    const state = await q.getState();
    expect(state.baseMap.has(STASH)).toBe(false);
    expect(state.workingMap.has(STASH)).toBe(false);
    expect(state.baseCommitSha).toBe('commit1');
  });

  it('is a no-op when the entry is already gone', async () => {
    const q = await freshQueue();
    const commit = vi.fn();
    const res = await q.resolveStash('.jade/stash/missing.json', { pat: 't', commit });
    expect(res).toEqual({ removed: false });
    expect(commit).not.toHaveBeenCalled();
  });

  it('re-parents pending queued batches on the resolution commit', async () => {
    const q = await freshQueue(baseMap({ [STASH]: '{}\n' }));
    await q.enqueue(createBatch('new.md', 'N\n', '2026-06-01T00:00:00.000Z'));
    const { commit } = recordingCommit();

    await q.resolveStash(STASH, { pat: 't', commit });

    const state = await q.getState();
    expect(state.queue).toHaveLength(1);
    expect(state.workingMap.get('new.md')).toBe('N\n');
    expect(state.workingMap.has(STASH)).toBe(false);
  });
});

describe('OpQueue.sync — truncated remote', () => {
  it('skips conflict processing and only pushes', async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch('a.md', 'A\n', '2026-06-01T00:00:00.000Z'));
    const { commit, calls } = recordingCommit();

    const res = await q.sync({
      pat: 't',
      fetchRemote: remoteOf({ commitSha: 'remoteC', truncated: true }),
      commit,
    });

    expect(res).toEqual({ pushed: 1, stashed: 0, conflicted: false });
    expect(calls[0].args.baseCommitSha).toBe('base000'); // no rebase onto remote
  });
});
