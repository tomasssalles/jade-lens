import { describe, it, expect } from 'vitest';
import { reconcileDraft, draftCommitMessage } from './draftReconcile.js';
import { buildDraft } from './draftStore.js';
import { applyUnifiedDiff } from '../mutation/unifiedDiff.js';

const mdDraft = (over = {}) =>
  buildDraft({
    filePath: 'notes.md',
    beforeSnapshot: 'a\nb\nc\n',
    editorContent: 'a\nB\nc\n',
    timestamp: '2026-06-01T00:00:00.000Z',
    ...over,
  });

describe('reconcileDraft', () => {
  it('discards a draft with no actual change', () => {
    const d = mdDraft({ editorContent: 'a\nb\nc\n' });
    expect(reconcileDraft(d, 'anything else\n')).toEqual({ action: 'discard', reason: 'no-change' });
  });

  it('restores when the file is unchanged since the session began', () => {
    const d = mdDraft();
    expect(reconcileDraft(d, 'a\nb\nc\n')).toEqual({ action: 'restore' });
  });

  it('stashes a self-contained, replayable entry when the file changed underneath', () => {
    const d = mdDraft();
    const decision = reconcileDraft(d, 'a\nDIFFERENT\nc\n');
    expect(decision.action).toBe('stash');
    expect(decision.batch.timestamp).toBe('2026-06-01T00:00:00.000Z');
    expect(decision.batch.commitMessage).toBe(draftCommitMessage('notes.md'));

    // The op + ancestor reproduce the user's edit independent of current state.
    const op = decision.batch.operations[0];
    expect(op).toMatchObject({ op: 'unified_diff', path: 'notes.md' });
    const ancestor = decision.ancestorMap.get('notes.md');
    expect(ancestor).toBe('a\nb\nc\n');
    expect(applyUnifiedDiff(ancestor, op.diff)).toBe('a\nB\nc\n');
  });

  it('treats a remotely-deleted file as a conflict and stashes', () => {
    const decision = reconcileDraft(mdDraft(), undefined);
    expect(decision.action).toBe('stash');
    expect(decision.ancestorMap.get('notes.md')).toBe('a\nb\nc\n');
  });

  it('defers json_field drafts (whole-file ancestor not available yet)', () => {
    const d = buildDraft({
      filePath: 'p.json',
      beforeSnapshot: 'old value',
      editorContent: 'new value',
      editContext: { type: 'json_field', jsonFilePath: 'p.json', fieldPath: '/Notes' },
    });
    expect(reconcileDraft(d, 'changed value')).toEqual({ action: 'unsupported', reason: 'json_field' });
  });
});
