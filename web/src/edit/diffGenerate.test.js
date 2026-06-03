// Tests for the 0-context unified-diff generator (Phase 5a). The core guarantee
// is the round-trip: applying generateUnifiedDiff(before, after) to `before`
// reproduces `after` exactly. We pin that property on hand-picked cases, on a
// randomized fuzz corpus, and on the real conformance unified_diff fixtures.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateUnifiedDiff, DiffGenerateError } from './diffGenerate.js';
import { applyUnifiedDiff } from '../mutation/unifiedDiff.js';

/** The generator's headline contract, asserted everywhere. */
function roundTrips(before, after) {
  const diff = generateUnifiedDiff(before, after);
  if (diff === null) return before === after;
  return applyUnifiedDiff(before, diff) === after;
}

describe('generateUnifiedDiff — basics', () => {
  it('returns null for identical text', () => {
    expect(generateUnifiedDiff('a\nb\n', 'a\nb\n')).toBeNull();
    expect(generateUnifiedDiff('', '')).toBeNull();
  });

  it('replaces a single line', () => {
    const before = 'line one\nline two\nline three\n';
    const after = 'line one\nLINE TWO\nline three\n';
    expect(generateUnifiedDiff(before, after)).toBe('@@ -2,1 +2,1 @@\n-line two\n+LINE TWO\n');
    expect(roundTrips(before, after)).toBe(true);
  });

  it('inserts in the middle (pure insert, old_count 0)', () => {
    const before = 'a\nb\n';
    const after = 'a\nNEW\nb\n';
    expect(roundTrips(before, after)).toBe(true);
    // Pure insert after line 1 → old_start is the 0-indexed insertion point.
    expect(generateUnifiedDiff(before, after)).toBe('@@ -1,0 +2,1 @@\n+NEW\n');
  });

  it('inserts at the very start', () => {
    expect(roundTrips('a\nb\n', 'HEAD\na\nb\n')).toBe(true);
    expect(generateUnifiedDiff('a\nb\n', 'HEAD\na\nb\n')).toBe('@@ -0,0 +1,1 @@\n+HEAD\n');
  });

  it('appends at the end', () => {
    expect(roundTrips('a\nb\n', 'a\nb\nc\n')).toBe(true);
  });

  it('deletes a line (pure delete, new_count 0)', () => {
    const before = 'a\nb\nc\n';
    const after = 'a\nc\n';
    expect(roundTrips(before, after)).toBe(true);
    expect(generateUnifiedDiff(before, after)).toBe('@@ -2,1 +1,0 @@\n-b\n');
  });

  it('handles multiple separated hunks against original line numbers', () => {
    const before = '1\n2\n3\n4\n5\n6\n';
    const after = 'ONE\n2\n3\n4\n5\nSIX\n';
    expect(roundTrips(before, after)).toBe(true);
    expect(generateUnifiedDiff(before, after)).toBe(
      '@@ -1,1 +1,1 @@\n-1\n+ONE\n@@ -6,1 +6,1 @@\n-6\n+SIX\n',
    );
  });

  it('handles a multi-line replacement block', () => {
    expect(roundTrips('a\nb\nc\nd\n', 'a\nX\nY\nZ\nd\n')).toBe(true);
  });

  it('builds a file from empty and empties a file', () => {
    expect(roundTrips('', 'hello\nworld\n')).toBe(true);
    expect(roundTrips('hello\nworld\n', '')).toBe(true);
  });

  it('preserves an unchanged non-newline-terminated final line', () => {
    // Last line has no trailing newline but is NOT edited → copied verbatim.
    expect(roundTrips('a\nb\nno-nl', 'CHANGED\nb\nno-nl')).toBe(true);
  });

  it('throws when an edit lands on a non-newline-terminated final line', () => {
    // The applier always re-adds `\n` to added lines, so this is unrepresentable.
    expect(() => generateUnifiedDiff('a\nb\n', 'a\nb')).toThrow(DiffGenerateError);
    expect(() => generateUnifiedDiff('a\nold', 'a\nnew')).toThrow(DiffGenerateError);
  });
});

describe('generateUnifiedDiff — fuzz round-trip', () => {
  // Deterministic LCG so failures are reproducible.
  let s = 123456789;
  function rand() {
    s = (1103515245 * s + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  }
  function randLines(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(String.fromCharCode(97 + Math.floor(rand() * 8)));
    return out;
  }

  it('round-trips 500 random newline-terminated edits', () => {
    for (let t = 0; t < 500; t++) {
      const base = randLines(Math.floor(rand() * 12));
      const edited = base.slice();
      const mutations = Math.floor(rand() * 5);
      for (let mIdx = 0; mIdx < mutations; mIdx++) {
        const kind = Math.floor(rand() * 3);
        const pos = Math.floor(rand() * (edited.length + 1));
        if (kind === 0) edited.splice(pos, 0, 'NEW' + Math.floor(rand() * 100));
        else if (kind === 1 && edited.length) edited.splice(pos % edited.length, 1);
        else if (edited.length) edited[pos % edited.length] = 'MOD' + Math.floor(rand() * 100);
      }
      const before = base.length ? base.join('\n') + '\n' : '';
      const after = edited.length ? edited.join('\n') + '\n' : '';
      expect(roundTrips(before, after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`).toBe(true);
    }
  });
});

describe('generateUnifiedDiff — conformance fixtures', () => {
  const casesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../conformance/cases');
  const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));

  // For every unified_diff op whose file exists (as a string) in both the
  // case's `before` and its successful `after`, the generator must reproduce
  // the same after the case's hand-written diff produces.
  const pairs = [];
  for (const file of files) {
    const c = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
    const after = c.expect?.after;
    if (!after) continue; // rejection cases have no clean after
    for (const op of c.operations ?? []) {
      if (op.op !== 'unified_diff') continue;
      const before = c.before?.[op.path];
      const result = after[op.path];
      if (typeof before === 'string' && typeof result === 'string') {
        pairs.push({ file, path: op.path, before, after: result });
      }
    }
  }

  it('found unified_diff fixtures to check', () => {
    expect(pairs.length).toBeGreaterThan(0);
  });

  it.each(pairs)('round-trips $file ($path)', ({ before, after }) => {
    expect(roundTrips(before, after)).toBe(true);
  });
});
