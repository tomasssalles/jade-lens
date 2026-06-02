import { describe, it, expect, vi } from 'vitest';
import { OpQueue } from './opQueue.js';
import { createMemoryQueueStore } from './queueStore.js';
import { initQueueFromRead } from './syncController.js';

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
  contentMap: baseMap({ 'notes.md': 'x\n' }),
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
      operations: [{ op: 'create_file', path: 'new.md', content: 'y\n' }],
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
