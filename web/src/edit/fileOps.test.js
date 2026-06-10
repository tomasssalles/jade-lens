import { describe, it, expect } from 'vitest';
import { buildRename, buildDelete, describeDeleteRejection } from './fileOps.js';
import { run } from '../mutation/index.js';

const VERSION = 'v0.1.0';
const base = (extra = {}) => new Map([['.jade/version', VERSION], ...Object.entries(extra)]);

describe('buildRename', () => {
  it('builds a one-op rename_path batch with a static message', () => {
    expect(buildRename('a/old.md', 'a/new.md')).toEqual({
      operations: [{ op: 'rename_path', from: 'a/old.md', to: 'a/new.md' }],
      commitMessage: 'Manual edit: moved a/old.md → a/new.md',
    });
  });

  it('moves the file and auto-rewrites wikilinks pointing at it', () => {
    const tree = base({
      'notes.md': 'see [[projects/old.md]] for details\n',
      'projects/old.md': 'body\n',
    });
    const { operations, commitMessage } = buildRename('projects/old.md', 'projects/new.md');
    const out = run(tree, operations, commitMessage);
    expect(out.has('projects/old.md')).toBe(false);
    expect(out.get('projects/new.md')).toBe('body\n');
    expect(out.get('notes.md')).toBe('see [[projects/new.md]] for details\n');
  });
});

describe('buildDelete', () => {
  it('builds a one-op delete_path batch with a static message', () => {
    expect(buildDelete('a/gone.md')).toEqual({
      operations: [{ op: 'delete_path', path: 'a/gone.md' }],
      commitMessage: 'Manual edit: deleted a/gone.md',
    });
  });

  it('deletes an unreferenced file', () => {
    const tree = base({ 'gone.md': 'bye\n' });
    const { operations, commitMessage } = buildDelete('gone.md');
    const out = run(tree, operations, commitMessage);
    expect(out.has('gone.md')).toBe(false);
  });

  it('is rejected (with referrers) when the file is still referenced', () => {
    const tree = base({
      'gone.md': 'bye\n',
      'notes.md': 'link [[gone.md]] here\n',
      'other.md': 'also [[gone.md]]\n',
    });
    const { operations, commitMessage } = buildDelete('gone.md');
    let thrown;
    try {
      run(tree, operations, commitMessage);
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe('WIKILINK_DEAD');
    const msg = describeDeleteRejection(thrown);
    expect(msg).toContain('notes.md');
    expect(msg).toContain('other.md');
    expect(msg).toContain('2 files');
  });
});

describe('describeDeleteRejection', () => {
  it('returns null for unrelated errors', () => {
    expect(describeDeleteRejection(null)).toBeNull();
    expect(describeDeleteRejection(new Error('boom'))).toBeNull();
    expect(describeDeleteRejection({ code: 'TARGET_NOT_FOUND' })).toBeNull();
  });

  it('dedupes multiple links from the same file', () => {
    const err = { code: 'WIKILINK_DEAD', references: [['a.md', 'x'], ['a.md', 'x/y']] };
    const msg = describeDeleteRejection(err);
    expect(msg).toContain('1 file:');
    expect(msg).toContain('a.md');
  });
});
