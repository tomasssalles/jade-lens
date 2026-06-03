// Startup draft-vs-remote reconciliation (Phase 5b; design in
// docs/web/editing.md "Draft persistence" → "On app startup"). Pure decision
// logic — no IndexedDB, no network. The orchestration that acts on a decision
// (commit the stash, delete the draft) lives in syncController.reconcileDrafts.
//
// On startup, for each persisted draft we compare the file's CURRENT content
// against the draft's `beforeSnapshot` (the content when editing began):
//   • editor unchanged from before        → discard (nothing was edited)
//   • current === beforeSnapshot           → restore (safe to reopen the editor)
//   • current changed out from under it    → conflict: derive the op and STASH it
//     (the in-progress edit isn't lost; the user reviews it in the synced stash)

import { generateUnifiedDiff } from './diffGenerate.js';

/** Static, skimmable commit message for a stashed editing session (DESIGN §7.3). */
export function draftCommitMessage(filePath) {
  return `Manual edit — ${filePath}`;
}

/**
 * Decide what to do with one draft given the file's current content.
 *
 * @param {object} draft - a record from the draft store.
 * @param {string|undefined} currentContent - the file's current content (from
 *   the queue's workingMap), or undefined if the file no longer exists.
 * @returns {{action: 'discard', reason: string}
 *          | {action: 'restore'}
 *          | {action: 'stash', batch: {operations: Array<object>, commitMessage: string, timestamp: string}, ancestorMap: Map<string,string>}
 *          | {action: 'unsupported', reason: string}}
 */
export function reconcileDraft(draft, currentContent) {
  const { editContext, beforeSnapshot, editorContent, filePath, timestamp } = draft;

  // Nothing was actually changed in the session — drop it.
  if (editorContent === beforeSnapshot) return { action: 'discard', reason: 'no-change' };

  // The file is exactly as the session started → reopening is safe.
  if (currentContent === beforeSnapshot) return { action: 'restore' };

  // Conflict: the file moved on (edited elsewhere, or deleted) while a draft
  // sat unsaved. Preserve the work as a stash entry rather than discard it.
  if (editContext?.type === 'json_field') {
    // A faithful json_patch stash needs the whole-file ancestor; the field-only
    // draft doesn't carry it. Deferred with the JSON-field editing UI (5c).
    return { action: 'unsupported', reason: 'json_field' };
  }

  // markdown_file: one unified_diff from the pristine ancestor to the edit. The
  // ancestor IS the draft's beforeSnapshot — what the diff was authored against —
  // so the stash entry is self-contained and replayable independent of the repo.
  const diff = generateUnifiedDiff(beforeSnapshot, editorContent);
  return {
    action: 'stash',
    batch: {
      operations: [{ op: 'unified_diff', path: filePath, diff }],
      commitMessage: draftCommitMessage(filePath),
      timestamp,
    },
    ancestorMap: new Map([[filePath, beforeSnapshot]]),
  };
}
