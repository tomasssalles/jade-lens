// JSON Patch GENERATOR (Phase 5h groundwork of
// docs/mutation-sync-implementation-plan.md; design in docs/web/editing.md "Raw
// JSON editing"). The mutation pipeline only *applies* json_patch
// (mutation/jsonPatch.js); raw JSON editing needs to *derive* an RFC 6902 patch
// from before→after parsed values. Pure logic — no React, no network.
//
// This is the only legal way to commit a whole-file JSON edit, since the op model
// forbids unified_diff on .json files. We produce a CORRECT (not necessarily
// minimal) patch by a structural diff: changed leaf → replace, removed key →
// remove, added key → add, recurse into common keys/indices. No `move`/`copy`
// detection. Round-trip is conformance-pinned against the applier in the tests.

import { appendPointer } from './jsonPointer.js';

/** Structural equality (objects key-order-independent, arrays order-sensitive). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function kind(v) {
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return 'primitive'; // string | number | boolean | null
}

function diff(before, after, path, patch) {
  if (deepEqual(before, after)) return;

  const bk = kind(before);
  const ak = kind(after);
  if (bk !== ak || bk === 'primitive') {
    // Type change or a differing leaf — replace wholesale (path '' = whole doc).
    patch.push({ op: 'replace', path, value: after });
    return;
  }

  if (bk === 'array') {
    const common = Math.min(before.length, after.length);
    for (let i = 0; i < common; i++) diff(before[i], after[i], appendPointer(path, i), patch);
    // Removals high→low so earlier indices stay valid during sequential apply.
    for (let i = before.length - 1; i >= after.length; i--) {
      patch.push({ op: 'remove', path: appendPointer(path, i) });
    }
    // Appends in order (each lands at the end of the growing array).
    for (let i = before.length; i < after.length; i++) {
      patch.push({ op: 'add', path: `${path}/-`, value: after[i] });
    }
    return;
  }

  // Both plain objects.
  for (const k of Object.keys(before)) {
    if (!Object.hasOwn(after, k)) patch.push({ op: 'remove', path: appendPointer(path, k) });
  }
  for (const k of Object.keys(after)) {
    if (!Object.hasOwn(before, k)) {
      patch.push({ op: 'add', path: appendPointer(path, k), value: after[k] });
    } else {
      diff(before[k], after[k], appendPointer(path, k), patch);
    }
  }
}

/**
 * Derive an RFC 6902 patch turning the parsed value `before` into `after`.
 *
 * @param {*} before - parsed JSON value (object/array/primitive).
 * @param {*} after - parsed JSON value.
 * @returns {Array<object> | null} the patch ops, or `null` if the values are
 *   structurally equal (caller no-ops — no commit, no log entry).
 */
export function generateJsonPatch(before, after) {
  const patch = [];
  diff(before, after, '', patch);
  return patch.length ? patch : null;
}
