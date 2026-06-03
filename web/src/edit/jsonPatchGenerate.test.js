// Tests for the JSON Patch generator (Phase 5h groundwork). The headline
// guarantee — applyJsonPatch(before, generate(before, after)) deep-equals after
// — is pinned on hand-picked cases and a randomized fuzz corpus.
import { describe, it, expect } from 'vitest';
import { generateJsonPatch } from './jsonPatchGenerate.js';
import { applyJsonPatch } from '../mutation/jsonPatch.js';

// Structural equality — key order is intentionally NOT preserved by the
// generator (the patched result re-serializes canonically), so compare by value.
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function roundTrips(before, after) {
  const patch = generateJsonPatch(before, after);
  const result = patch === null ? before : applyJsonPatch(before, patch);
  return deepEqual(result, after);
}

describe('generateJsonPatch — basics', () => {
  it('returns null for structurally equal values (key order ignored)', () => {
    expect(generateJsonPatch({ a: 1, b: 2 }, { b: 2, a: 1 })).toBeNull();
    expect(generateJsonPatch([1, 2], [1, 2])).toBeNull();
    expect(generateJsonPatch('x', 'x')).toBeNull();
  });

  it('replaces a changed leaf', () => {
    expect(generateJsonPatch({ a: 1 }, { a: 2 })).toEqual([{ op: 'replace', path: '/a', value: 2 }]);
  });

  it('adds and removes object keys', () => {
    const patch = generateJsonPatch({ a: 1, gone: true }, { a: 1, added: 'x' });
    expect(patch).toContainEqual({ op: 'remove', path: '/gone' });
    expect(patch).toContainEqual({ op: 'add', path: '/added', value: 'x' });
    expect(roundTrips({ a: 1, gone: true }, { a: 1, added: 'x' })).toBe(true);
  });

  it('handles nested objects', () => {
    expect(roundTrips({ a: { b: { c: 1 } } }, { a: { b: { c: 2 }, d: 3 } })).toBe(true);
  });

  it('handles array element change, append, and shrink', () => {
    expect(roundTrips([1, 2, 3], [1, 9, 3])).toBe(true);
    expect(roundTrips([1, 2], [1, 2, 3, 4])).toBe(true);
    expect(roundTrips([1, 2, 3, 4], [1, 2])).toBe(true);
    expect(roundTrips([], ['a'])).toBe(true);
    expect(roundTrips(['a'], [])).toBe(true);
  });

  it('handles type changes including null', () => {
    expect(roundTrips({ a: null }, { a: 5 })).toBe(true);
    expect(roundTrips({ a: 5 }, { a: null })).toBe(true);
    expect(roundTrips({ a: [1] }, { a: { x: 1 } })).toBe(true);
    expect(roundTrips({ a: 'x' }, { a: [1, 2] })).toBe(true);
    expect(roundTrips(1, { a: 1 })).toBe(true); // root type change
  });

  it('escapes JSON Pointer special characters in keys', () => {
    const before = { 'a/b': 1, 'c~d': 2 };
    const after = { 'a/b': 9, 'c~d': 2 };
    expect(generateJsonPatch(before, after)).toEqual([{ op: 'replace', path: '/a~1b', value: 9 }]);
    expect(roundTrips(before, after)).toBe(true);
  });
});

describe('generateJsonPatch — fuzz round-trip', () => {
  let s = 987654321;
  const rand = () => {
    s = (1103515245 * s + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  // A random small JSON value, bounded depth.
  function randValue(depth) {
    const r = rand();
    if (depth <= 0 || r < 0.4) {
      const leaf = rand();
      if (leaf < 0.25) return Math.floor(rand() * 10);
      if (leaf < 0.5) return ['a', 'b', 'c'][Math.floor(rand() * 3)];
      if (leaf < 0.7) return rand() < 0.5;
      return null;
    }
    if (r < 0.7) {
      const n = Math.floor(rand() * 4);
      return Array.from({ length: n }, () => randValue(depth - 1));
    }
    const obj = {};
    const n = Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) obj['k' + Math.floor(rand() * 5)] = randValue(depth - 1);
    return obj;
  }

  it('round-trips 800 random before/after pairs', () => {
    for (let t = 0; t < 800; t++) {
      const before = randValue(3);
      const after = randValue(3);
      expect(
        roundTrips(before, after),
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      ).toBe(true);
    }
  });
});
