import { describe, it, expect } from 'vitest';
import { batchTouchedPaths, changedPaths, firstConflictIndex } from './conflicts.js';

const mapOf = (obj) => new Map(Object.entries(obj));
const batch = (operations) => ({ operations });

describe('batchTouchedPaths', () => {
  const universe = ['a.md', 'b.md', 'dir/x.md', 'dir/y.md', 'dir/sub/z.md'];

  it('returns the path for in-file ops', () => {
    expect(batchTouchedPaths([{ op: 'json_patch', path: 'a.md' }], universe)).toEqual(
      new Set(['a.md']),
    );
    expect(batchTouchedPaths([{ op: 'unified_diff', path: 'b.md' }], universe)).toEqual(
      new Set(['b.md']),
    );
    expect(batchTouchedPaths([{ op: 'create_file', path: 'new.md' }], universe)).toEqual(
      new Set(['new.md']),
    );
  });

  it('expands a directory delete to every file under it', () => {
    expect(batchTouchedPaths([{ op: 'delete_path', path: 'dir' }], universe)).toEqual(
      new Set(['dir/x.md', 'dir/y.md', 'dir/sub/z.md']),
    );
  });

  it('treats a file delete as just that file', () => {
    expect(batchTouchedPaths([{ op: 'delete_path', path: 'a.md' }], universe)).toEqual(
      new Set(['a.md']),
    );
  });

  it('covers both source and destination of a file rename', () => {
    expect(
      batchTouchedPaths([{ op: 'rename_path', from: 'a.md', to: 'c.md' }], universe),
    ).toEqual(new Set(['a.md', 'c.md']));
  });

  it('covers source subtree and mapped destinations of a directory rename', () => {
    expect(
      batchTouchedPaths([{ op: 'rename_path', from: 'dir', to: 'moved' }], universe),
    ).toEqual(
      new Set([
        'dir/x.md',
        'dir/y.md',
        'dir/sub/z.md',
        'moved',
        'moved/x.md',
        'moved/y.md',
        'moved/sub/z.md',
      ]),
    );
  });

  it('normalises op paths', () => {
    expect(batchTouchedPaths([{ op: 'json_patch', path: './a.md' }], universe)).toEqual(
      new Set(['a.md']),
    );
  });
});

describe('changedPaths', () => {
  it('detects modified, added, and removed files', () => {
    const base = mapOf({ keep: '1', mod: 'old', gone: 'x' });
    const remote = mapOf({ keep: '1', mod: 'new', added: 'y' });
    expect(changedPaths(base, remote)).toEqual(new Set(['mod', 'added', 'gone']));
  });

  it('is empty when maps are identical', () => {
    const m = mapOf({ a: '1', b: '2' });
    expect(changedPaths(m, new Map(m))).toEqual(new Set());
  });
});

describe('firstConflictIndex', () => {
  it('returns -1 when the remote changed nothing', () => {
    const base = mapOf({ a: '1' });
    const queue = [batch([{ op: 'json_patch', path: 'a' }])];
    expect(firstConflictIndex(queue, base, new Map(base))).toBe(-1);
  });

  it('returns -1 when local and remote touch different files', () => {
    const base = mapOf({ a: '1', b: '1' });
    const remote = mapOf({ a: '1', b: '2' }); // remote changed b
    const queue = [batch([{ op: 'json_patch', path: 'a' }])]; // local touched a
    expect(firstConflictIndex(queue, base, remote)).toBe(-1);
  });

  // The §4 worked example: batch1=A,B; batch2=C,D; batch3=E,F; remote changed C
  // → first conflict is batch index 1 (the C,D batch).
  it('pivots at the first batch touching a remotely-changed file', () => {
    const base = mapOf({ A: '1', B: '1', C: '1', D: '1', E: '1', F: '1' });
    const remote = mapOf({ A: '1', B: '1', C: '2', D: '1', E: '1', F: '1' });
    const queue = [
      batch([{ op: 'json_patch', path: 'A' }, { op: 'json_patch', path: 'B' }]),
      batch([{ op: 'json_patch', path: 'C' }, { op: 'json_patch', path: 'D' }]),
      batch([{ op: 'json_patch', path: 'E' }, { op: 'json_patch', path: 'F' }]),
    ];
    expect(firstConflictIndex(queue, base, remote)).toBe(1);
  });

  it('flags rename-vs-edit on the same file as a conflict', () => {
    const base = mapOf({ 'notes.md': 'x' });
    const remote = mapOf({ 'notes.md': 'edited' }); // remote edited notes.md
    const queue = [batch([{ op: 'rename_path', from: 'notes.md', to: 'renamed.md' }])];
    expect(firstConflictIndex(queue, base, remote)).toBe(0);
  });

  it('flags delete-vs-edit on the same file as a conflict', () => {
    const base = mapOf({ 'notes.md': 'x' });
    const remote = mapOf({ 'notes.md': 'edited' });
    const queue = [batch([{ op: 'delete_path', path: 'notes.md' }])];
    expect(firstConflictIndex(queue, base, remote)).toBe(0);
  });

  it('flags a remote delete of a locally-edited file as a conflict', () => {
    const base = mapOf({ 'notes.md': 'x' });
    const remote = new Map(); // remote deleted notes.md
    const queue = [batch([{ op: 'unified_diff', path: 'notes.md' }])];
    expect(firstConflictIndex(queue, base, remote)).toBe(0);
  });

  it('flags both-sides-created-same-path (rename destination collision)', () => {
    const base = mapOf({ 'a.md': 'x' });
    const remote = mapOf({ 'a.md': 'x', 'b.md': 'remote-made-this' }); // remote added b.md
    const queue = [batch([{ op: 'rename_path', from: 'a.md', to: 'b.md' }])];
    expect(firstConflictIndex(queue, base, remote)).toBe(0);
  });
});
