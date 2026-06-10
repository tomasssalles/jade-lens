/**
 * Sidecar promotion — trigger logic and path mapping.
 *
 * Uses markdown-it (CommonMark-compliant) to parse text and count top-level
 * content blocks. The Python counterpart (jadelens/sidecar.py) must produce
 * identical counts for the same input.
 */

import MarkdownIt from 'markdown-it';

const _md = new MarkdownIt();

// Token types counted when they appear at document level (token.level === 0).
// List items are counted at any nesting depth.
const BLOCK_OPEN_TYPES_AT_ROOT = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
]);

/**
 * Count top-level content blocks in CommonMark text.
 *
 * Each paragraph, heading, fenced code block, blockquote, or individual list
 * item (at any nesting depth) counts as one block.
 *
 * @param {string} text
 * @returns {number}
 */
export function countContentBlocks(text) {
  const tokens = _md.parse(text, {});
  let count = 0;
  for (const tok of tokens) {
    if (BLOCK_OPEN_TYPES_AT_ROOT.has(tok.type) && tok.level === 0) {
      count++;
    } else if (tok.type === 'fence' && tok.level === 0) {
      count++;
    } else if (tok.type === 'list_item_open') {
      count++;
    }
  }
  return count;
}

/**
 * Return true if *text* should be promoted to a sidecar (> 1 block).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isPromotable(text) {
  return countContentBlocks(text) > 1;
}
