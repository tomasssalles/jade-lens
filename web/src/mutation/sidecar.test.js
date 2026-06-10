/**
 * Tests for countContentBlocks and isPromotable — mirrors tests/test_sidecar.py.
 * Both suites must agree on every case (cross-client conformance).
 */
import { describe, it, expect } from 'vitest';
import { countContentBlocks, isPromotable } from './sidecar.js';

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
