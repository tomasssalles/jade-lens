import { describe, it, expect } from 'vitest';
import { createMemoryDraftStore, buildDraft, draftId } from './draftStore.js';

describe('draftId', () => {
  it('is stable for the same target and distinct across targets', () => {
    expect(draftId('a.md')).toBe(draftId('a.md'));
    expect(draftId('a.md')).not.toBe(draftId('b.md'));
    // A markdown file and a JSON field on the same path are different edits.
    expect(draftId('p.json')).not.toBe(draftId('p.json', '/Notes'));
  });
});

describe('buildDraft', () => {
  it('derives id + defaults and keeps the given fields', () => {
    const d = buildDraft({ filePath: 'a.md', editorContent: 'new', beforeSnapshot: 'old' });
    expect(d.id).toBe(draftId('a.md'));
    expect(d.editContext).toEqual({ type: 'markdown_file' });
    expect(typeof d.timestamp).toBe('string');
    expect(d).toMatchObject({ filePath: 'a.md', editorContent: 'new', beforeSnapshot: 'old' });
  });

  it('folds the field path into the id for json_field drafts', () => {
    const d = buildDraft({
      filePath: 'p.json',
      editorContent: 'x',
      beforeSnapshot: 'y',
      editContext: { type: 'json_field', jsonFilePath: 'p.json', fieldPath: '/Notes' },
    });
    expect(d.id).toBe(draftId('p.json', '/Notes'));
  });
});

describe('createMemoryDraftStore', () => {
  it('puts, gets, lists and deletes', async () => {
    const store = createMemoryDraftStore();
    expect(await store.getAll()).toEqual([]);

    const a = buildDraft({ filePath: 'a.md', editorContent: '1', beforeSnapshot: '0' });
    const b = buildDraft({ filePath: 'b.md', editorContent: '1', beforeSnapshot: '0' });
    await store.put(a);
    await store.put(b);

    expect(await store.get(a.id)).toEqual(a);
    expect((await store.getAll()).map((d) => d.id).sort()).toEqual([a.id, b.id].sort());

    await store.delete(a.id);
    expect(await store.get(a.id)).toBeUndefined();
    expect(await store.getAll()).toHaveLength(1);
  });

  it('isolates stored records from later mutation by reference', async () => {
    const store = createMemoryDraftStore();
    const d = buildDraft({ filePath: 'a.md', editorContent: '1', beforeSnapshot: '0' });
    await store.put(d);
    d.editorContent = 'mutated';
    expect((await store.get(d.id)).editorContent).toBe('1');
  });
});
