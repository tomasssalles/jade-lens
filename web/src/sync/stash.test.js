import { describe, it, expect } from 'vitest';
import {
  buildStashEntry,
  compactTimestamp,
  stashFilename,
  serializeStashEntry,
  hasStashEntries,
  listStashPaths,
} from './stash.js';

const mapOf = (obj) => new Map(Object.entries(obj));

describe('compactTimestamp / stashFilename', () => {
  it('formats the timestamp in ISO basic form', () => {
    expect(compactTimestamp(new Date('2026-06-01T14:30:22.123Z'))).toBe('20260601T143022Z');
  });

  it('builds a .jade/stash/<ts>-<shortuuid>.json filename', () => {
    const name = stashFilename('2026-06-01T14:30:22.123Z', 'a1b2c3d4-0000-0000-0000-000000000000');
    expect(name).toBe('.jade/stash/20260601T143022Z-a1b2c3d4.json');
  });

  it('mints a uuid when none is given', () => {
    const name = stashFilename('2026-06-01T14:30:22.123Z');
    expect(name).toMatch(/^\.jade\/stash\/20260601T143022Z-[0-9a-f]{8}\.json$/);
  });
});

describe('buildStashEntry', () => {
  it('captures pristine ancestors for every touched, pre-existing file', () => {
    const base = mapOf({
      'a.md': 'original A\n',
      'b.md': 'original B\n',
      'untouched.md': 'x\n',
    });
    const batch = {
      timestamp: '2026-06-01T14:30:22.123Z',
      operations: [
        { op: 'unified_diff', path: 'a.md', diff: '...' },
        { op: 'unified_diff', path: 'b.md', diff: '...' },
      ],
    };
    const entry = buildStashEntry(batch, base);

    expect(entry.timestamp).toBe('2026-06-01T14:30:22.123Z');
    expect(entry.ancestors).toEqual({ 'a.md': 'original A\n', 'b.md': 'original B\n' });
    expect(entry.operations).toBe(batch.operations);
  });

  it('omits files the batch creates (no ancestor content)', () => {
    const base = mapOf({ 'existing.md': 'x\n' });
    const batch = {
      timestamp: '2026-06-01T14:30:22.123Z',
      operations: [{ op: 'create_file', path: 'new.md', content: 'y\n' }],
    };
    expect(buildStashEntry(batch, base).ancestors).toEqual({});
  });

  it('captures the whole subtree ancestor for a directory delete', () => {
    const base = mapOf({ 'dir/x.md': 'X\n', 'dir/y.md': 'Y\n', 'other.md': 'O\n' });
    const batch = {
      timestamp: '2026-06-01T14:30:22.123Z',
      operations: [{ op: 'delete_path', path: 'dir' }],
    };
    expect(buildStashEntry(batch, base).ancestors).toEqual({
      'dir/x.md': 'X\n',
      'dir/y.md': 'Y\n',
    });
  });

  it('sorts ancestor keys for deterministic, cross-client output', () => {
    const base = mapOf({ 'z.md': 'Z\n', 'a.md': 'A\n', 'm.md': 'M\n' });
    const batch = {
      timestamp: '2026-06-01T14:30:22.123Z',
      operations: [
        { op: 'unified_diff', path: 'z.md', diff: '...' },
        { op: 'unified_diff', path: 'a.md', diff: '...' },
        { op: 'unified_diff', path: 'm.md', diff: '...' },
      ],
    };
    expect(Object.keys(buildStashEntry(batch, base).ancestors)).toEqual(['a.md', 'm.md', 'z.md']);
  });
});

describe('serializeStashEntry', () => {
  it('emits JS-canonical JSON with a trailing newline', () => {
    const entry = {
      timestamp: '2026-06-01T14:30:22.123Z',
      ancestors: { 'a.md': 'x\n' },
      operations: [{ op: 'unified_diff', path: 'a.md', diff: 'd' }],
    };
    expect(serializeStashEntry(entry)).toBe(JSON.stringify(entry, null, 2) + '\n');
    expect(serializeStashEntry(entry).endsWith('\n')).toBe(true);
  });
});

describe('hasStashEntries / listStashPaths', () => {
  it('detects and lists stash files, ignoring everything else under .jade', () => {
    const map = mapOf({
      '.jade/version': 'v0.1.0',
      '.jade/stash/20260601T150000Z-bbbb.json': '{}',
      '.jade/stash/20260601T140000Z-aaaa.json': '{}',
      '.jade/operations-log/v0.1.0.jsonl': '...',
      'notes.md': 'x',
    });
    expect(hasStashEntries(map)).toBe(true);
    expect(listStashPaths(map)).toEqual([
      '.jade/stash/20260601T140000Z-aaaa.json',
      '.jade/stash/20260601T150000Z-bbbb.json',
    ]);
  });

  it('reports empty when there are no stash files', () => {
    const map = mapOf({ '.jade/version': 'v0.1.0', 'notes.md': 'x' });
    expect(hasStashEntries(map)).toBe(false);
    expect(listStashPaths(map)).toEqual([]);
  });
});
