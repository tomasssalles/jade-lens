import { describe, it, expect, vi } from 'vitest';
import { OpQueue } from './opQueue.js';
import { createMemoryQueueStore } from './queueStore.js';
import { initQueueFromRead, commitEdit, syncPending, getWorkingContent, getWorkingTree } from './syncController.js';
import { PushConflictError, GitHubWriteError } from './githubWrite.js';
import { buildCheckboxToggle } from '../edit/checkbox.js';

const VERSION = 'v0.1.0';
const baseMap = (extra = {}) => new Map([['.jade/version', VERSION], ...Object.entries(extra)]);

function fakeHead(overrides = {}) {
  return vi.fn(async () => ({
    branch: 'main',
    commitSha: 'headC',
    treeSha: 'headT',
    ...overrides,
  }));
}

const read = (extra) => ({
  repoUrl: 'https://github.com/o/r',
  branch: 'main',
  pat: 'tok',
  contentMap: baseMap({
    'notes.md': 'x\n',
    'Index.json': '[\n  {\n    "File": "[[notes.md]]",\n    "Scope": "user"\n  }\n]\n',
  }),
  truncated: false,
  ...extra,
});

describe('initQueueFromRead', () => {
  it('initialises the queue with the fetched head SHAs and the read content', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    const getHead = fakeHead();

    const ok = await initQueueFromRead(q, read(), { getHead });

    expect(ok).toBe(true);
    expect(getHead).toHaveBeenCalledWith('https://github.com/o/r', 'tok', 'main');
    const state = await q.getState();
    expect(state.baseCommitSha).toBe('headC');
    expect(state.baseTreeSha).toBe('headT');
    expect(state.baseMap.get('notes.md')).toBe('x\n');
    expect(state.queue).toHaveLength(0);
  });

  it('refuses to init from a truncated tree (no head fetch, no state)', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    const getHead = fakeHead();

    const ok = await initQueueFromRead(q, read({ truncated: true }), { getHead });

    expect(ok).toBe(false);
    expect(getHead).not.toHaveBeenCalled();
    expect(await q.getState()).toBeUndefined();
  });

  it('does not clobber a pending edit queue for the same repo', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    await q.enqueue({
      operations: [{ op: 'create_file', path: 'new.md', content: 'y\n', indexed: true, scope: 'user' }],
      commitMessage: 'add new',
      timestamp: '2026-06-01T00:00:00.000Z',
    });

    const getHead = fakeHead({ commitSha: 'differentC' });
    const ok = await initQueueFromRead(q, read(), { getHead });

    expect(ok).toBe(true);
    expect(getHead).not.toHaveBeenCalled(); // skipped — pending work preserved
    const state = await q.getState();
    expect(state.queue).toHaveLength(1);
    expect(state.baseCommitSha).toBe('headC'); // unchanged
  });

  it('re-inits when the read is for a different repo', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });

    const getHead = fakeHead({ commitSha: 'otherC' });
    const ok = await initQueueFromRead(
      q,
      read({ repoUrl: 'https://github.com/o/other' }),
      { getHead },
    );

    expect(ok).toBe(true);
    expect(getHead).toHaveBeenCalled();
    expect((await q.getState()).baseCommitSha).toBe('otherC');
  });
});

describe('commitEdit', () => {
  const TODO = 'todo.md';
  const repoUrl = 'https://github.com/o/r';

  function editArgs(content = '- [ ] a\n', line = 1) {
    const { operations, commitMessage } = buildCheckboxToggle(content, line, TODO);
    return {
      repoUrl,
      branch: 'main',
      pat: 'tok',
      operations,
      commitMessage,
      contentMap: baseMap({
        [TODO]: content,
        'Index.json': `[\n  {\n    "File": "[[${TODO}]]",\n    "Scope": "user"\n  }\n]\n`,
      }),
    };
  }

  it('initialises, applies the toggle, and pushes (synced)', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    const commit = vi.fn(async () => ({ commitSha: 'c1', treeSha: 't1', changed: true }));

    const res = await commitEdit(editArgs(), { queue: q, commit, getHead: fakeHead() });

    expect(res.outcome).toBe('synced');
    expect(res.error).toBeNull();
    expect(res.workingMap.get(TODO)).toBe('- [x] a\n');
    expect((await q.getState()).queue).toHaveLength(0); // pushed
  });

  it('surfaces a read-only-PAT error but keeps the optimistic local change', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    const commit = vi.fn(async () => {
      throw new GitHubWriteError('forbidden', 403);
    });

    const res = await commitEdit(editArgs(), { queue: q, commit, getHead: fakeHead() });

    expect(res.outcome).toBe('pending');
    expect(res.error).toMatch(/read-only|write/i);
    expect(res.workingMap.get(TODO)).toBe('- [x] a\n'); // applied locally
    expect((await q.getState()).queue).toHaveLength(1); // still queued to retry
  });

  it('stays silent on a network error (no message), leaving the change queued', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    const commit = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const res = await commitEdit(editArgs(), { queue: q, commit, getHead: fakeHead() });

    expect(res.outcome).toBe('pending');
    expect(res.error).toBeNull();
    expect((await q.getState()).queue).toHaveLength(1);
  });

  it('falls back to sync on a push conflict and rebases when there is no real clash', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    let n = 0;
    const commit = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new PushConflictError(); // optimistic push rejected
      return { commitSha: `c${n}`, treeSha: `t${n}`, changed: true };
    });
    // Remote advanced but to identical content → sync rebases, no stash.
    const fetchRemote = async () => ({
      branch: 'main',
      commitSha: 'remoteC',
      treeSha: 'remoteT',
      contentMap: baseMap({
        [TODO]: '- [ ] a\n',
        'Index.json': `[\n  {\n    "File": "[[${TODO}]]",\n    "Scope": "user"\n  }\n]\n`,
      }),
      truncated: false,
    });

    const res = await commitEdit(editArgs(), { queue: q, commit, fetchRemote, getHead: fakeHead() });

    expect(res.outcome).toBe('synced');
    expect(res.stashed).toBe(0);
    expect(res.workingMap.get(TODO)).toBe('- [x] a\n');
  });
});

describe('syncPending', () => {
  const repoUrl = 'https://github.com/o/r';

  async function queueWithPending() {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    await q.enqueue({
      operations: [{ op: 'create_file', path: 'n.md', content: 'x\n', indexed: true, scope: 'user' }],
      commitMessage: 'add n',
      timestamp: '2026-06-01T00:00:00.000Z',
    });
    return q;
  }

  it('reports hadPending=false when the queue is empty', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    const res = await syncPending({ repoUrl, pat: 'tok' }, { queue: q, commit: vi.fn() });
    expect(res.hadPending).toBe(false);
    expect(res.outcome).toBe('synced');
  });

  it('pushes pending work and reports synced', async () => {
    const q = await queueWithPending();
    const commit = vi.fn(async () => ({ commitSha: 'c1', treeSha: 't1', changed: true }));
    const res = await syncPending({ repoUrl, pat: 'tok' }, { queue: q, commit });
    expect(res).toMatchObject({ hadPending: true, outcome: 'synced', error: null });
    expect((await q.getState()).queue).toHaveLength(0);
  });

  it('surfaces the classified error on a read-only token, keeping the queue', async () => {
    const q = await queueWithPending();
    const commit = vi.fn(async () => {
      throw new GitHubWriteError('forbidden', 403);
    });
    const res = await syncPending({ repoUrl, pat: 'tok' }, { queue: q, commit });
    expect(res.hadPending).toBe(true);
    expect(res.outcome).toBe('pending');
    expect(res.error).toMatch(/read-only|write/i);
    expect((await q.getState()).queue).toHaveLength(1);
  });
});

describe('initQueueFromRead — already at head', () => {
  it('skips re-init when the read reports the queue’s current head, preserving working content', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    await q.enqueue({
      operations: [{ op: 'create_file', path: 'new.md', content: 'N\n', indexed: true, scope: 'user' }],
      commitMessage: 'add',
      timestamp: 't',
    });
    const commit = vi.fn(async () => ({ commitSha: 'synced1', treeSha: 'tt', changed: true }));
    await q.push({ pat: 'tok', commit }); // base advances to synced1; workingMap keeps new.md

    // A re-read reports the same head with a (stale) content map — must be ignored.
    const ok = await initQueueFromRead(
      q,
      read({ contentMap: baseMap() }),
      { getHead: fakeHead({ commitSha: 'synced1' }) },
    );

    expect(ok).toBe(true);
    const state = await q.getState();
    expect(state.workingMap.get('new.md')).toBe('N\n'); // not wiped by a re-init
    expect(state.baseCommitSha).toBe('synced1');
  });
});

describe('getWorkingContent', () => {
  it('returns the queue working content for a path', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    expect(await getWorkingContent('notes.md', { repoUrl: 'https://github.com/o/r' }, q)).toBe('x\n');
  });

  it('returns undefined when the queue is uninitialised', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    expect(await getWorkingContent('notes.md', {}, q)).toBeUndefined();
  });

  it('returns undefined for a different repo', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    expect(
      await getWorkingContent('notes.md', { repoUrl: 'https://github.com/o/other' }, q),
    ).toBeUndefined();
  });
});

describe('getWorkingTree', () => {
  it('returns one blob item per working-map path plus the content map', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(
      q,
      read({ contentMap: baseMap({ 'notes.md': 'x\n', 'a/b.md': 'y\n' }) }),
      { getHead: fakeHead() },
    );
    const wt = await getWorkingTree({ repoUrl: 'https://github.com/o/r' }, q);
    expect(wt.items.map((i) => i.path).sort()).toEqual(['.jade/version', 'a/b.md', 'notes.md']);
    expect(wt.items.every((i) => i.type === 'blob')).toBe(true);
    expect(wt.contentMap.get('a/b.md')).toBe('y\n');
  });

  it('reflects an enqueued create in the items', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    await q.enqueue({ operations: [{ op: 'create_file', path: 'new.md', content: 'z\n', indexed: true, scope: 'user' }], commitMessage: 'add' });
    const wt = await getWorkingTree({ repoUrl: 'https://github.com/o/r' }, q);
    expect(wt.items.map((i) => i.path)).toContain('new.md');
  });

  it('returns null when uninitialised or for a different repo', async () => {
    const q = new OpQueue(createMemoryQueueStore());
    expect(await getWorkingTree({}, q)).toBeNull();
    await initQueueFromRead(q, read(), { getHead: fakeHead() });
    expect(await getWorkingTree({ repoUrl: 'https://github.com/o/other' }, q)).toBeNull();
  });
});
