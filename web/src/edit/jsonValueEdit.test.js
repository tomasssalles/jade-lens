import { describe, it, expect } from 'vitest';
import { buildJsonValueEdit, jsonValueCommitMessage } from './jsonValueEdit.js';
import { escapePointerToken, appendPointer } from './jsonPointer.js';
import { run } from '../mutation/index.js';

const VERSION = 'v0.1.0';
const base = (extra = {}) => new Map([['.jade/version', VERSION], ...Object.entries(extra)]);

describe('jsonPointer', () => {
  it('escapes ~ and /', () => {
    expect(escapePointerToken('a/b')).toBe('a~1b');
    expect(escapePointerToken('c~d')).toBe('c~0d');
    expect(escapePointerToken('plain')).toBe('plain');
  });
  it('appends (unescaped) tokens to a base', () => {
    expect(appendPointer('', 'a')).toBe('/a');
    expect(appendPointer('/x', 'a/b')).toBe('/x/a~1b');
    expect(appendPointer('/x', 0)).toBe('/x/0');
  });
});

describe('buildJsonValueEdit', () => {
  it('builds a one-op json_patch replace at the pointer', () => {
    expect(buildJsonValueEdit('a.json', '/active', true)).toEqual({
      operations: [
        { op: 'json_patch', path: 'a.json', patch: [{ op: 'replace', path: '/active', value: true }] },
      ],
      commitMessage: jsonValueCommitMessage('a.json', '/active'),
    });
  });

  it('flips a boolean through the pipeline with canonical output', () => {
    const tree = base({ 'a.json': '{\n  "active": false,\n  "name": "x"\n}\n' });
    const { operations, commitMessage } = buildJsonValueEdit('a.json', '/active', true);
    const out = run(tree, operations, commitMessage);
    expect(out.get('a.json')).toBe('{\n  "active": true,\n  "name": "x"\n}\n');
  });

  it('labels a root-pointer edit as (root)', () => {
    expect(jsonValueCommitMessage('a.json', '')).toContain('(root)');
  });
});
