// File-level structural micro-edits (Phase 5e/5f groundwork; design in
// docs/web/editing.md "file-level structural edits"). Pure batch builders — no
// React, no network. Each produces ONE structure op that flows through the shared
// commitEdit pipeline as an immediate commit, exactly like a bot edit.

/** Static, skimmable commit messages (DESIGN §7.3). */
export function renameCommitMessage(from, to) {
  return `Manual edit: moved ${from} → ${to}`;
}
export function deleteCommitMessage(path) {
  return `Manual edit: deleted ${path}`;
}

/**
 * One-op `rename_path` batch. Moving a file or directory; the pipeline's
 * post-apply pass automatically rewrites every `[[wikilink]]` pointing at `from`
 * (or anything under it) to `to`. The pipeline enforces: source exists, target
 * does not, and (for files) the suffix is preserved.
 *
 * @param {string} from - current repo-relative path.
 * @param {string} to - new repo-relative path.
 * @returns {{operations: Array<object>, commitMessage: string}}
 */
export function buildRename(from, to) {
  return {
    operations: [{ op: 'rename_path', from, to }],
    commitMessage: renameCommitMessage(from, to),
  };
}

/**
 * One-op `delete_path` batch. Deleting a file or directory; the pipeline REJECTS
 * it (`DELETE_DANGLING_WIKILINK`) if the path is still referenced by a wikilink
 * after the batch — see describeDeleteRejection for the user-facing message. The
 * workflow does not remove references; the user clears them first.
 *
 * @param {string} path - repo-relative path to delete.
 * @returns {{operations: Array<object>, commitMessage: string}}
 */
export function buildDelete(path) {
  return {
    operations: [{ op: 'delete_path', path }],
    commitMessage: deleteCommitMessage(path),
  };
}

/**
 * If `err` is a delete rejected because wikilink references survive, return a
 * user-facing message naming the referencing files; otherwise return null (the
 * caller falls back to generic error handling). Reads the structured
 * `references` list the pipeline attaches to the error.
 *
 * @param {Error & {code?: string, references?: Array<[string, string]>}} err
 * @returns {string | null}
 */
export function describeDeleteRejection(err) {
  if (!err || err.code !== 'DELETE_DANGLING_WIKILINK') return null;
  const refs = Array.isArray(err.references) ? err.references : [];
  const files = [...new Set(refs.map(([file]) => file))];
  if (files.length === 0) {
    return 'Can’t delete — the file is still referenced by wikilinks. Remove those links first.';
  }
  return (
    `Can’t delete — still referenced by ${files.length} file` +
    `${files.length === 1 ? '' : 's'}: ${files.join(', ')}. Remove those links first.`
  );
}
