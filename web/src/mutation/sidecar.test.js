/**
 * Tests for countContentBlocks and isPromotable — mirrors tests/test_sidecar.py.
 * Both suites must agree on every case (cross-client conformance).
 */
import { describe, it, expect } from 'vitest';
import {
  countContentBlocks, isPromotable,
  pointerToSidecarPath, jsonPathFromSidecar, sidecarPathToPointer,
  isSidecarPath, truncateMarkdownPreview,
} from './sidecar.js';

// ---------------------------------------------------------------------------
// Cases: 0 or 1 block (not promotable)
// ---------------------------------------------------------------------------

describe('not promotable (≤ 1 block)', () => {
  const cases = [
    ['single paragraph', 'Hello, world.\n'],
    ['no trailing newline', 'Hello, world.'],
    ['multi-line single paragraph', 'Line one continues\nright here without a blank line.\n'],
    ['single h1', '# Title\n'],
    ['single h2', '## Sub-heading\n'],
    ['single fenced code block', '```python\nprint("hi")\n```\n'],
    ['single blockquote', '> A quote.\n'],
    ['single bullet point (-)', '- One item\n'],
    ['single bullet point (*)', '* One item\n'],
    ['single ordered item', '1. First item\n'],
    ['empty string', ''],
    ['whitespace only', '   \n'],
  ];

  for (const [label, text] of cases) {
    it(label, () => {
      expect(countContentBlocks(text)).toBeLessThanOrEqual(1);
      expect(isPromotable(text)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Cases: > 1 block (promotable)
// ---------------------------------------------------------------------------

describe('promotable (> 1 block)', () => {
  const cases = [
    ['two paragraphs', 'Para one.\n\nPara two.\n', 2],
    ['heading + paragraph', '# Title\n\nBody text.\n', 2],
    ['two bullet points', '- Alpha\n- Beta\n', 2],
    ['three bullet points', '- A\n- B\n- C\n', 3],
    ['paragraph + fenced code', 'Description.\n\n```\ncode\n```\n', 2],
    ['paragraph + blockquote', 'Before.\n\n> A quote.\n', 2],
    ['two blockquotes', '> First.\n\n> Second.\n', 2],
    ['ordered list with 2 items', '1. First\n2. Second\n', 2],
    ['heading + paragraph + code', '# H\n\nText.\n\n```\ncode\n```\n', 3],
  ];

  for (const [label, text, expected] of cases) {
    it(label, () => {
      expect(countContentBlocks(text)).toBe(expected);
      expect(isPromotable(text)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('wikilink string parses as a single paragraph (not promotable)', () => {
    expect(countContentBlocks('[[notes.md]]')).toBe(1);
    expect(isPromotable('[[notes.md]]')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5b: JSON Pointer ↔ sidecar filepath mapping
// ---------------------------------------------------------------------------

describe('pointerToSidecarPath', () => {
  it('simple key', () => {
    expect(pointerToSidecarPath('Garden.json', '/notes')).toBe('Garden.sidecars/notes.md');
  });
  it('nested object path', () => {
    expect(pointerToSidecarPath('Garden.json', '/phases/research/summary'))
      .toBe('Garden.sidecars/phases/research/summary.md');
  });
  it('array index', () => {
    expect(pointerToSidecarPath('Garden.json', '/comparisons/0/description'))
      .toBe('Garden.sidecars/comparisons/0/description.md');
  });
  it('subdirectory json', () => {
    expect(pointerToSidecarPath('a/b/Work.json', '/tasks/2/summary'))
      .toBe('a/b/Work.sidecars/tasks/2/summary.md');
  });
  it('RFC6901 tilde escape', () => {
    // Key with ~ is escaped as ~0 in pointer, unescaped in filename
    expect(pointerToSidecarPath('F.json', '/key~0name')).toBe('F.sidecars/key~name.md');
  });
  it('throws on pointer without leading slash', () => {
    expect(() => pointerToSidecarPath('F.json', 'notes')).toThrow();
  });
});

describe('jsonPathFromSidecar', () => {
  it('root level', () => {
    expect(jsonPathFromSidecar('Garden.sidecars/notes.md')).toBe('Garden.json');
  });
  it('nested sidecar', () => {
    expect(jsonPathFromSidecar('Garden.sidecars/comparisons/0/description.md')).toBe('Garden.json');
  });
  it('subdirectory json', () => {
    expect(jsonPathFromSidecar('a/b/Work.sidecars/tasks/2/summary.md')).toBe('a/b/Work.json');
  });
  it('throws when no .sidecars component', () => {
    expect(() => jsonPathFromSidecar('Garden/notes.md')).toThrow();
  });
});

describe('sidecarPathToPointer', () => {
  it('simple key', () => {
    const data = { notes: 'some text' };
    expect(sidecarPathToPointer('Garden.sidecars/notes.md', data)).toBe('/notes');
  });
  it('array index', () => {
    const data = { comparisons: [{ description: 'text' }] };
    expect(sidecarPathToPointer('Garden.sidecars/comparisons/0/description.md', data))
      .toBe('/comparisons/0/description');
  });
  it('object key "0" treated as string key not array index', () => {
    const data = { '0': 'value' };
    expect(sidecarPathToPointer('F.sidecars/0.md', data)).toBe('/0');
  });
  it('array index for nested array', () => {
    const data = { items: [{ name: 'x' }] };
    expect(sidecarPathToPointer('F.sidecars/items/0/name.md', data)).toBe('/items/0/name');
  });
  it('RFC6901 tilde in key is escaped in pointer', () => {
    const data = { 'key~name': 'value' };
    expect(sidecarPathToPointer('F.sidecars/key~name.md', data)).toBe('/key~0name');
  });
  it('throws on missing key', () => {
    const data = { other: 'value' };
    expect(() => sidecarPathToPointer('Garden.sidecars/notes.md', data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isSidecarPath
// ---------------------------------------------------------------------------

describe('isSidecarPath', () => {
  it('detects a top-level sidecar directory', () => {
    expect(isSidecarPath('Garden.sidecars/notes.md')).toBe(true);
  });
  it('detects a nested sidecar directory', () => {
    expect(isSidecarPath('a/b/Work.sidecars/field.md')).toBe(true);
  });
  it('returns false for a regular .md file', () => {
    expect(isSidecarPath('notes.md')).toBe(false);
  });
  it('returns false for a .json file', () => {
    expect(isSidecarPath('Garden.json')).toBe(false);
  });
  it('returns false for a path that merely contains "sidecars" without the dot', () => {
    expect(isSidecarPath('mysidecars/notes.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// truncateMarkdownPreview
// ---------------------------------------------------------------------------

describe('truncateMarkdownPreview', () => {
  it('short single paragraph — not truncated', () => {
    const { segments, truncated } = truncateMarkdownPreview('Hello world.\n', 100);
    expect(segments).toEqual([{ type: 'text', content: 'Hello world.' }]);
    expect(truncated).toBe(false);
  });

  it('plain text exceeding limit — truncated at char boundary', () => {
    const { segments, truncated } = truncateMarkdownPreview('ABCDE', 3);
    expect(segments).toEqual([{ type: 'text', content: 'ABC' }]);
    expect(truncated).toBe(true);
  });

  it('bold span fits — included in full', () => {
    const { segments, truncated } = truncateMarkdownPreview('**bold**\n', 100);
    expect(segments).toEqual([{ type: 'strong', content: 'bold' }]);
    expect(truncated).toBe(false);
  });

  it('bold span does not fit — excluded, truncated flag set', () => {
    const { segments, truncated } = truncateMarkdownPreview('AB **bold**\n', 6);
    // "AB " fits (3 chars), bold (4 chars) would exceed budget of 3 remaining
    expect(segments.map((s) => s.content).join('')).toBe('AB ');
    expect(truncated).toBe(true);
  });

  it('inline code fits — included', () => {
    const { segments, truncated } = truncateMarkdownPreview('Use `run`.\n', 100);
    expect(segments).toEqual([
      { type: 'text', content: 'Use ' },
      { type: 'code', content: 'run' },
      { type: 'text', content: '.' },
    ]);
    expect(truncated).toBe(false);
  });

  it('inline code does not fit — excluded, truncated', () => {
    // "Use " (4 chars) fits; code_inline "run" (3 chars) would push to 7 > 5 → excluded
    const { segments, truncated } = truncateMarkdownPreview('Use `run`.\n', 5);
    expect(segments).toEqual([{ type: 'text', content: 'Use ' }]);
    expect(truncated).toBe(true);
  });

  it('multiple blocks — first block only, truncated flag set', () => {
    const { segments, truncated } = truncateMarkdownPreview('Para one.\n\nPara two.\n', 100);
    expect(segments).toEqual([{ type: 'text', content: 'Para one.' }]);
    expect(truncated).toBe(true);
  });

  it('em span fits', () => {
    const { segments, truncated } = truncateMarkdownPreview('*italic*\n', 100);
    expect(segments).toEqual([{ type: 'em', content: 'italic' }]);
    expect(truncated).toBe(false);
  });

  it('softbreak replaced with space', () => {
    const { segments, truncated } = truncateMarkdownPreview('line one\nline two\n', 100);
    const text = segments.map((s) => s.content).join('');
    expect(text).toBe('line one line two');
    expect(truncated).toBe(false);
  });

  it('empty string — empty segments, not truncated', () => {
    const { segments, truncated } = truncateMarkdownPreview('', 100);
    expect(segments).toEqual([]);
    expect(truncated).toBe(false);
  });
});
