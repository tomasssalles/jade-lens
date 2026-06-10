/**
 * Tests for sidecar promotion in workflow.run().
 */
import { describe, it, expect } from 'vitest';
import { run } from './workflow.js';

const TS = '2024-01-01T00:00:00.000Z';

function makeTree(files) {
  const tree = new Map();
  for (const [path, content] of Object.entries(files)) {
    tree.set(path, content);
  }
  return tree;
}

describe('run – sidecar promotion', () => {
  it('promotes multi-block string value to sidecar', () => {
    const tree = makeTree({
      'Garden.json': '{"notes": "short"}\n',
      'Index.json': '[{"File": "[[Garden.json]]", "Scope": "Garden"}]\n',
    });

    const result = run(
      tree,
      [
        {
          op: 'json_patch',
          path: 'Garden.json',
          patch: [{ op: 'add', path: '/notes', value: 'Para one.\n\nPara two.\n' }],
        },
      ],
      'Promote notes',
      { timestamp: TS },
    );

    expect(JSON.parse(result.get('Garden.json')).notes).toBe('[[Garden.sidecars/notes.md]]');
    expect(result.get('Garden.sidecars/notes.md')).toBe('Para one.\n\nPara two.\n');
  });

  it('does not promote single-block string value', () => {
    const tree = makeTree({
      'Notes.json': '{"summary": "short"}\n',
      'Index.json': '[{"File": "[[Notes.json]]", "Scope": "Notes"}]\n',
    });

    const result = run(
      tree,
      [
        {
          op: 'json_patch',
          path: 'Notes.json',
          patch: [{ op: 'replace', path: '/summary', value: 'Just one paragraph.' }],
        },
      ],
      'Update summary',
      { timestamp: TS },
    );

    expect(JSON.parse(result.get('Notes.json')).summary).toBe('Just one paragraph.');
    for (const key of result.keys()) {
      expect(key).not.toContain('.sidecars');
    }
  });

  it('resolves /- to concrete index for array append', () => {
    const tree = makeTree({
      'Projects.json': '{"items": []}\n',
      'Index.json': '[{"File": "[[Projects.json]]", "Scope": "Projects"}]\n',
    });

    const result = run(
      tree,
      [
        {
          op: 'json_patch',
          path: 'Projects.json',
          patch: [{ op: 'add', path: '/items/-', value: 'Step one.\n\nStep two.\n' }],
        },
      ],
      'Promote item',
      { timestamp: TS },
    );

    expect(JSON.parse(result.get('Projects.json')).items).toEqual([
      '[[Projects.sidecars/items/0.md]]',
    ]);
    expect(result.get('Projects.sidecars/items/0.md')).toBe('Step one.\n\nStep two.\n');
  });

  it('does not re-promote existing wikilink value', () => {
    const tree = makeTree({
      'Notes.json': '{"notes": "[[Notes.sidecars/notes.md]]"}\n',
      'Notes.sidecars/notes.md': 'Para one.\n\nPara two.\n',
      'Index.json': '[{"File": "[[Notes.json]]", "Scope": "Notes"}]\n',
    });

    const result = run(
      tree,
      [
        {
          op: 'json_patch',
          path: 'Notes.json',
          patch: [{ op: 'replace', path: '/notes', value: '[[Notes.sidecars/notes.md]]' }],
        },
      ],
      'Keep wikilink',
      { timestamp: TS },
    );

    expect(JSON.parse(result.get('Notes.json')).notes).toBe('[[Notes.sidecars/notes.md]]');
  });

  it('input tree is not mutated', () => {
    const tree = makeTree({
      'Garden.json': '{"notes": "short"}\n',
      'Index.json': '[{"File": "[[Garden.json]]", "Scope": "Garden"}]\n',
    });

    run(
      tree,
      [
        {
          op: 'json_patch',
          path: 'Garden.json',
          patch: [{ op: 'add', path: '/notes', value: 'Para one.\n\nPara two.\n' }],
        },
      ],
      'Promote',
      { timestamp: TS },
    );

    expect(JSON.parse(tree.get('Garden.json')).notes).toBe('short');
    expect(tree.has('Garden.sidecars/notes.md')).toBe(false);
  });

  it('log records original pre-promotion operations', () => {
    const tree = makeTree({
      'Garden.json': '{"notes": "short"}\n',
      'Index.json': '[{"File": "[[Garden.json]]", "Scope": "Garden"}]\n',
    });

    const rawOps = [
      {
        op: 'json_patch',
        path: 'Garden.json',
        patch: [{ op: 'add', path: '/notes', value: 'Para one.\n\nPara two.\n' }],
      },
    ];

    const result = run(tree, rawOps, 'Promote notes', { timestamp: TS });

    const logLine = result.get('.jade/operations-log/v1.jsonl');
    const entry = JSON.parse(logLine);
    expect(entry.operations).toEqual(rawOps);
  });
});
