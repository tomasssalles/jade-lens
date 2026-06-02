// Checkbox micro-edit: derive the mutation for toggling a rendered task-list
// checkbox (Phase 3 of docs/mutation-sync-implementation-plan.md; design in
// docs/web/editing.md "Micro-edits"). Pure logic — no React, no network.
//
// A toggle flips `[ ]`↔`[x]` on a single source line and produces ONE
// `unified_diff` op (0-context), the same operation a bot edit would emit, so it
// flows through the shared mutation pipeline like any other change.

// The leading task-list marker on a line: indent, bullet (-, *, +), then the
// `[ ]` / `[x]` / `[X]` box. Capture groups: (1) everything up to and including
// the `[`, (2) the box character, (3) `]` and the rest of the line.
const TASK_MARKER_RE = /^(\s*[-*+] \[)([ xX])(\].*)$/;

/** A static, skimmable commit message for a checkbox toggle (DESIGN §7.3). */
export function checkboxCommitMessage(path) {
  return `Manual edit: toggled checkbox — ${path}`;
}

/**
 * Build the one-op `unified_diff` batch that toggles the checkbox on `line`
 * (1-based) of `content`. Returns `null` if that line isn't a task-list item
 * (so the caller can no-op safely rather than emit a bad diff).
 *
 * @param {string} content - the current file source.
 * @param {number} line - 1-based source line of the checkbox.
 * @param {string} path - the file's repo-relative path.
 * @returns {{operations: Array<object>, commitMessage: string} | null}
 */
export function buildCheckboxToggle(content, line, path) {
  const lines = content.split('\n');
  const original = lines[line - 1];
  if (original === undefined) return null;

  const m = TASK_MARKER_RE.exec(original);
  if (!m) return null;

  const newChar = m[2] === ' ' ? 'x' : ' ';
  const newLine = `${m[1]}${newChar}${m[3]}`;
  // 0-context single-line replacement; the pipeline verifies `-original` matches
  // the file at `line` before applying.
  const diff = `@@ -${line},1 +${line},1 @@\n-${original}\n+${newLine}\n`;

  return {
    operations: [{ op: 'unified_diff', path, diff }],
    commitMessage: checkboxCommitMessage(path),
  };
}
