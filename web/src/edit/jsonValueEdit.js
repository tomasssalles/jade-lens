// JSON value micro-edit (Phase 5g groundwork; design in docs/web/editing.md). A
// single leaf-value change in a `.json` file is one `json_patch` `replace` at the
// value's JSON Pointer — the shared shape for every JSON value micro-edit
// (boolean toggle first; date/time, number, wikilink reduce to the same thing).
// Pure logic — no React, no network. The no-op guard (don't commit an unchanged
// value) lives in the caller, which knows the original value.

/** Static, skimmable commit message (DESIGN §7.3). */
export function jsonValueCommitMessage(filePath, pointer) {
  return `Manual edit: updated ${pointer || '(root)'} — ${filePath}`;
}

/**
 * Build the one-op `json_patch` batch that replaces the value at `pointer`.
 *
 * @param {string} filePath - the `.json` file's repo-relative path.
 * @param {string} pointer - RFC 6901 pointer to the value (e.g. `/user/active`).
 * @param {*} value - the new JSON value.
 * @returns {{operations: Array<object>, commitMessage: string}}
 */
export function buildJsonValueEdit(filePath, pointer, value) {
  return {
    operations: [{ op: 'json_patch', path: filePath, patch: [{ op: 'replace', path: pointer, value }] }],
    commitMessage: jsonValueCommitMessage(filePath, pointer),
  };
}
