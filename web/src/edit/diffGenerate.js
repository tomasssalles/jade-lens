// 0-context unified-diff GENERATOR (Phase 5a of
// docs/mutation-sync-implementation-plan.md). The mutation pipeline only
// *parses/applies* diffs (web/src/mutation/unifiedDiff.js); text editing and
// draft-vs-remote reconciliation need to *derive* a diff from before→after full
// texts. Pure logic — no React, no network.
//
// The output is the exact 0-context format the pipeline consumes: hunks
// reference the ORIGINAL file's 1-indexed line numbers, removed lines carry the
// original content (sans trailing newline), added lines get `\n` on apply. We
// produce ONE diff string (possibly many hunks) and assert it round-trips
// through the real applier before returning, so a generated diff can never
// silently corrupt a file.

import { applyUnifiedDiff } from '../mutation/unifiedDiff.js';

export class DiffGenerateError extends Error {}

/** Mirror Python str.splitlines(keepends=True) — identical to the applier's. */
function splitlinesKeepends(s) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') {
      lines.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) lines.push(s.slice(start));
  return lines;
}

function stripTrailingNewline(line) {
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

// LCS over the differing middle (common prefix/suffix already trimmed by the
// caller). Returns an edit script of {t:'=', ai, bi} | {t:'-', ai} | {t:'+', bi}
// with indices relative to the slices passed in.
function lcsMiddle(a, b) {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] vs b[j:].
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: '=', ai: i, bi: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: '-', ai: i });
      i++;
    } else {
      ops.push({ t: '+', bi: j });
      j++;
    }
  }
  while (i < n) ops.push({ t: '-', ai: i++ });
  while (j < m) ops.push({ t: '+', bi: j++ });
  return ops;
}

// Full edit script over a,b. Trims the common prefix/suffix (cheap, and keeps
// hunks localized for the common "edit a few lines of a big file" case) then
// runs the LCS DP only on the middle.
function diffOps(a, b) {
  const n = a.length;
  const m = b.length;
  let lo = 0;
  while (lo < n && lo < m && a[lo] === b[lo]) lo++;
  let hi = 0;
  while (hi < n - lo && hi < m - lo && a[n - 1 - hi] === b[m - 1 - hi]) hi++;

  const ops = [];
  for (let k = 0; k < lo; k++) ops.push({ t: '=', ai: k, bi: k });
  for (const op of lcsMiddle(a.slice(lo, n - hi), b.slice(lo, m - hi))) {
    if (op.t === '=') ops.push({ t: '=', ai: lo + op.ai, bi: lo + op.bi });
    else if (op.t === '-') ops.push({ t: '-', ai: lo + op.ai });
    else ops.push({ t: '+', bi: lo + op.bi });
  }
  for (let k = 0; k < hi; k++) ops.push({ t: '=', ai: n - hi + k, bi: m - hi + k });
  return ops;
}

/**
 * Derive a 0-context unified diff turning `before` into `after`.
 *
 * @param {string} before - current file content.
 * @param {string} after - desired file content.
 * @returns {string | null} the diff text, or `null` if the texts are identical.
 * @throws {DiffGenerateError} if the change can't be represented in this format
 *   (only possible when `after`'s final line lacks a trailing newline and that
 *   line is part of an edit — the applier always re-adds `\n` to added lines).
 */
export function generateUnifiedDiff(before, after) {
  if (before === after) return null;

  const a = splitlinesKeepends(before);
  const b = splitlinesKeepends(after);
  const ops = diffOps(a, b);

  const hunks = [];
  let aPos = 0; // original lines consumed so far (0-indexed insertion point)
  let bPos = 0; // new lines consumed so far
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === '=') {
      aPos++;
      bPos++;
      k++;
      continue;
    }
    // A maximal run of changes (no '=' between).
    const removed = [];
    const added = [];
    const runStartA = aPos;
    const runStartB = bPos;
    while (k < ops.length && ops[k].t !== '=') {
      if (ops[k].t === '-') {
        removed.push(stripTrailingNewline(a[ops[k].ai]));
        aPos++;
      } else {
        added.push(stripTrailingNewline(b[ops[k].bi]));
        bPos++;
      }
      k++;
    }
    // old_start: 1-indexed for a removal; for a pure insert the applier uses
    // old_start directly as the 0-indexed insertion point.
    const oldStart = removed.length > 0 ? runStartA + 1 : runStartA;
    const newStart = added.length > 0 ? runStartB + 1 : runStartB;
    hunks.push({ oldStart, oldCount: removed.length, newStart, newCount: added.length, removed, added });
  }

  const diff = hunks
    .map((h) => {
      const header = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n`;
      const body =
        h.removed.map((l) => `-${l}\n`).join('') + h.added.map((l) => `+${l}\n`).join('');
      return header + body;
    })
    .join('');

  // Safety net: a generated diff must reproduce `after` exactly. The only way
  // this fails by construction is the non-newline-terminated-final-line edit.
  if (applyUnifiedDiff(before, diff) !== after) {
    throw new DiffGenerateError(
      'Cannot represent this change as a 0-context unified diff: the result is ' +
        'not newline-terminated on an edited final line (the applier always ' +
        'appends a newline to added lines).',
    );
  }
  return diff;
}
