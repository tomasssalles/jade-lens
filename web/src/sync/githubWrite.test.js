import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  computeTreeChanges,
  commitFileMap,
  getBranchHead,
  PushConflictError,
  GitHubWriteError,
} from './githubWrite.js';

const REPO = 'https://github.com/o/r';

function res(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('computeTreeChanges', () => {
  it('emits content entries for added and modified files', () => {
    const base = new Map([['a.md', 'A\n'], ['b.md', 'B\n']]);
    const next = new Map([['a.md', 'A\n'], ['b.md', 'B2\n'], ['c.md', 'C\n']]);
    const changes = computeTreeChanges(base, next);
    expect(changes).toEqual([
      { path: 'b.md', mode: '100644', type: 'blob', content: 'B2\n' },
      { path: 'c.md', mode: '100644', type: 'blob', content: 'C\n' },
    ]);
  });

  it('emits a null-sha entry for deleted files', () => {
    const base = new Map([['gone.md', 'x\n'], ['keep.md', 'k\n']]);
    const next = new Map([['keep.md', 'k\n']]);
    expect(computeTreeChanges(base, next)).toEqual([
      { path: 'gone.md', mode: '100644', type: 'blob', sha: null },
    ]);
  });

  it('returns nothing when maps are identical', () => {
    const base = new Map([['a.md', 'A\n']]);
    const next = new Map([['a.md', 'A\n']]);
    expect(computeTreeChanges(base, next)).toEqual([]);
  });
});

describe('commitFileMap', () => {
  it('creates tree → commit → ref update and returns the new commit sha', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined });
      if (opts.method === 'POST' && url.endsWith('/git/trees')) return res(201, { sha: 'tree2' });
      if (opts.method === 'POST' && url.endsWith('/git/commits')) return res(201, { sha: 'commit2' });
      if (opts.method === 'PATCH' && url.endsWith('/git/refs/heads/main')) return res(200, {});
      throw new Error(`unexpected ${opts.method} ${url}`);
    });

    const result = await commitFileMap(REPO, 'pat', {
      branch: 'main',
      baseCommitSha: 'commit1',
      baseTreeSha: 'tree1',
      baseMap: new Map([['a.md', 'A\n'], ['old.md', 'O\n']]),
      newMap: new Map([['a.md', 'A2\n']]), // a.md modified, old.md deleted
      message: 'Manual edit',
    });

    expect(result).toEqual({ commitSha: 'commit2', treeSha: 'tree2', changed: true });

    // Order: tree, commit, ref.
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com', '')}`)).toEqual([
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'PATCH /repos/o/r/git/refs/heads/main',
    ]);
    // Tree built on base_tree with the modify (content) + delete (sha:null).
    expect(calls[0].body).toEqual({
      base_tree: 'tree1',
      tree: [
        { path: 'a.md', mode: '100644', type: 'blob', content: 'A2\n' },
        { path: 'old.md', mode: '100644', type: 'blob', sha: null },
      ],
    });
    // Commit parented on the base sha.
    expect(calls[1].body).toEqual({ message: 'Manual edit', tree: 'tree2', parents: ['commit1'] });
    // Ref fast-forward (non-force).
    expect(calls[2].body).toEqual({ sha: 'commit2', force: false });
  });

  it('is a no-op (no network) when there are no changes', async () => {
    global.fetch = vi.fn();
    const result = await commitFileMap(REPO, 'pat', {
      branch: 'main',
      baseCommitSha: 'commit1',
      baseTreeSha: 'tree1',
      baseMap: new Map([['a.md', 'A\n']]),
      newMap: new Map([['a.md', 'A\n']]),
      message: 'noop',
    });
    expect(result).toEqual({ commitSha: 'commit1', changed: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws PushConflictError when the ref update is not a fast-forward (422)', async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (opts.method === 'POST' && url.endsWith('/git/trees')) return res(201, { sha: 'tree2' });
      if (opts.method === 'POST' && url.endsWith('/git/commits')) return res(201, { sha: 'commit2' });
      if (opts.method === 'PATCH') return res(422, { message: 'Update is not a fast forward' });
      throw new Error('unexpected');
    });

    await expect(
      commitFileMap(REPO, 'pat', {
        branch: 'main',
        baseCommitSha: 'stale',
        baseTreeSha: 'tree1',
        baseMap: new Map(),
        newMap: new Map([['a.md', 'A\n']]),
        message: 'm',
      }),
    ).rejects.toBeInstanceOf(PushConflictError);
  });

  it('throws GitHubWriteError (with status) on other ref-update failures', async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (opts.method === 'POST' && url.endsWith('/git/trees')) return res(201, { sha: 'tree2' });
      if (opts.method === 'POST' && url.endsWith('/git/commits')) return res(201, { sha: 'commit2' });
      if (opts.method === 'PATCH') return res(403, { message: 'Resource not accessible by personal access token' });
      throw new Error('unexpected');
    });

    const err = await commitFileMap(REPO, 'pat', {
      branch: 'main',
      baseCommitSha: 'c1',
      baseTreeSha: 't1',
      baseMap: new Map(),
      newMap: new Map([['a.md', 'A\n']]),
      message: 'm',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubWriteError);
    expect(err.status).toBe(403);
  });
});

describe('getBranchHead', () => {
  it('resolves default branch → ref sha → tree sha', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.endsWith('/repos/o/r')) return res(200, { default_branch: 'main' });
      if (url.endsWith('/git/ref/heads/main')) return res(200, { object: { sha: 'c1' } });
      if (url.endsWith('/git/commits/c1')) return res(200, { tree: { sha: 't1' } });
      throw new Error(`unexpected ${url}`);
    });
    expect(await getBranchHead(REPO, 'pat')).toEqual({
      branch: 'main',
      commitSha: 'c1',
      treeSha: 't1',
    });
  });

  it('uses an explicit branch without fetching repo info', async () => {
    const seen = [];
    global.fetch = vi.fn(async (url) => {
      seen.push(url);
      if (url.endsWith('/git/ref/heads/claude-ai')) return res(200, { object: { sha: 'c9' } });
      if (url.endsWith('/git/commits/c9')) return res(200, { tree: { sha: 't9' } });
      throw new Error(`unexpected ${url}`);
    });
    const head = await getBranchHead(REPO, 'pat', 'claude-ai');
    expect(head).toEqual({ branch: 'claude-ai', commitSha: 'c9', treeSha: 't9' });
    expect(seen.some((u) => u.endsWith('/repos/o/r'))).toBe(false);
  });
});
