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

// ---------------------------------------------------------------------------
// JSON Pointer ↔ sidecar filepath mapping
// ---------------------------------------------------------------------------

const SIDECARS_SUFFIX = '.sidecars';

/**
 * Return true if path is a sidecar file (any path component ends with .sidecars).
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isSidecarPath(path) {
  return path.split('/').some((p) => p.endsWith(SIDECARS_SUFFIX));
}

// ---------------------------------------------------------------------------
// Sidecar preview truncation
// ---------------------------------------------------------------------------

/**
 * Render a truncated inline preview of a markdown text (for the JSON card view).
 *
 * Returns an array of typed segments (text / strong / em / code) drawn from
 * the first content block, plus a `truncated` flag.  Truncation respects span
 * boundaries: plain text is cut at the character limit; spans (bold, em, code)
 * are included fully only when they fit in the remaining budget, otherwise the
 * walk stops before the span.
 *
 * @param {string} text  - raw markdown content
 * @param {number} maxChars - character budget (default 100)
 * @returns {{ segments: Array<{type:'text'|'strong'|'em'|'code', content:string}>, truncated: boolean }}
 */
export function truncateMarkdownPreview(text, maxChars = 100) {
  const tokens = _md.parse(text, {});

  // Find the first inline token and whether there are more blocks after it.
  let inlineToken = null;
  let hasMoreBlocks = false;
  for (const tok of tokens) {
    if (tok.type === 'inline') {
      if (inlineToken === null) {
        inlineToken = tok;
      } else {
        hasMoreBlocks = true;
        break;
      }
    }
  }
  if (!inlineToken) return { segments: [], truncated: false };

  const children = inlineToken.children || [];
  const segments = [];
  let chars = 0;
  let i = 0;
  let hitLimit = false;

  while (i < children.length && !hitLimit) {
    const tok = children[i];

    if (tok.type === 'softbreak' || tok.type === 'hardbreak') {
      if (chars > 0 && chars < maxChars) {
        segments.push({ type: 'text', content: ' ' });
        chars++;
      }
      i++;
    } else if (tok.type === 'text') {
      const remaining = maxChars - chars;
      if (tok.content.length === 0) {
        i++;
      } else if (tok.content.length <= remaining) {
        segments.push({ type: 'text', content: tok.content });
        chars += tok.content.length;
        i++;
      } else {
        segments.push({ type: 'text', content: tok.content.slice(0, remaining) });
        chars = maxChars;
        hitLimit = true;
      }
    } else if (tok.type === 'code_inline') {
      if (chars + tok.content.length <= maxChars) {
        segments.push({ type: 'code', content: tok.content });
        chars += tok.content.length;
        i++;
      } else {
        hitLimit = true;
      }
    } else if (tok.type === 'strong_open') {
      const inner = _collectSpanText(children, i + 1, 'strong_close');
      if (chars + inner.text.length <= maxChars) {
        segments.push({ type: 'strong', content: inner.text });
        chars += inner.text.length;
        i = inner.end + 1;
      } else {
        hitLimit = true;
      }
    } else if (tok.type === 'em_open') {
      const inner = _collectSpanText(children, i + 1, 'em_close');
      if (chars + inner.text.length <= maxChars) {
        segments.push({ type: 'em', content: inner.text });
        chars += inner.text.length;
        i = inner.end + 1;
      } else {
        hitLimit = true;
      }
    } else if (tok.type === 'link_open') {
      const inner = _collectSpanText(children, i + 1, 'link_close');
      if (chars + inner.text.length <= maxChars) {
        segments.push({ type: 'text', content: inner.text });
        chars += inner.text.length;
        i = inner.end + 1;
      } else {
        hitLimit = true;
      }
    } else {
      i++;
    }
  }

  return {
    segments,
    truncated: hitLimit || i < children.length || hasMoreBlocks,
  };
}

/** Collect text content from inline tokens until the closing type is found.
 *  Returns { text, end } where end is the index of the closing token. */
function _collectSpanText(tokens, start, closeType) {
  let text = '';
  let j = start;
  while (j < tokens.length && tokens[j].type !== closeType) {
    if (tokens[j].type === 'text') text += tokens[j].content;
    j++;
  }
  return { text, end: j };
}

/** RFC 6901 unescape: ~1 → /, ~0 → ~ */
function unescapePointerSegment(seg) {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** RFC 6901 escape: ~ → ~0, / → ~1 */
function escapePointerSegment(seg) {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Derive sidecar filepath from a .json path and RFC 6901 pointer.
 *
 * pointer must start with '/' and have at least one segment.
 *
 * @param {string} jsonPath - e.g. "Garden.json" or "a/b/Work.json"
 * @param {string} pointer  - e.g. "/notes" or "/comparisons/0/description"
 * @returns {string} - e.g. "Garden.sidecars/notes.md"
 */
/**
 * Return the .sidecars directory path for a given .json file.
 *
 * @param {string} jsonPath - e.g. "Garden.json" or "a/Work.json"
 * @returns {string} - e.g. "Garden.sidecars" or "a/Work.sidecars"
 */
export function sidecarDirForJson(jsonPath) {
  const lastSlash = jsonPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? jsonPath.slice(0, lastSlash + 1) : '';
  const basename = lastSlash >= 0 ? jsonPath.slice(lastSlash + 1) : jsonPath;
  const stem = basename.endsWith('.json') ? basename.slice(0, -5) : basename;
  return dir + stem + SIDECARS_SUFFIX;
}

export function pointerToSidecarPath(jsonPath, pointer) {
  if (!pointer.startsWith('/')) throw new Error(`JSON pointer must start with '/': ${pointer}`);
  const segments = pointer.slice(1).split('/').map(unescapePointerSegment);
  if (segments.length === 0 || segments.some((s) => s === ''))
    throw new Error(`Invalid JSON pointer: ${pointer}`);

  const lastSlash = jsonPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? jsonPath.slice(0, lastSlash + 1) : '';
  const basename = lastSlash >= 0 ? jsonPath.slice(lastSlash + 1) : jsonPath;
  const stem = basename.endsWith('.json') ? basename.slice(0, -5) : basename;

  const sidecarDir = dir + stem + SIDECARS_SUFFIX;
  return sidecarDir + '/' + segments.join('/') + '.md';
}

/**
 * Return the .json filepath that owns a sidecar.
 *
 * @param {string} sidecarPath - e.g. "Garden.sidecars/notes.md"
 * @returns {string} - e.g. "Garden.json"
 */
export function jsonPathFromSidecar(sidecarPath) {
  const parts = sidecarPath.split('/');
  const idx = parts.findIndex((p) => p.endsWith(SIDECARS_SUFFIX));
  if (idx < 0) throw new Error(`No '${SIDECARS_SUFFIX}' component in path: ${sidecarPath}`);
  const stem = parts[idx].slice(0, -SIDECARS_SUFFIX.length);
  const prefix = parts.slice(0, idx).join('/');
  return (prefix ? prefix + '/' : '') + stem + '.json';
}

/**
 * Reconstruct the RFC 6901 pointer from a sidecar path and its JSON data.
 *
 * Uses the actual JSON structure at each level to distinguish array indices
 * from object keys, so object key "0" and array index 0 are unambiguous.
 *
 * @param {string} sidecarPath - repo-relative path to the sidecar .md file
 * @param {*} jsonData - parsed JSON content of the owning .json file
 * @returns {string} - RFC 6901 pointer, e.g. "/comparisons/0/description"
 */
export function sidecarPathToPointer(sidecarPath, jsonData) {
  const parts = sidecarPath.split('/');
  const sidecarIdx = parts.findIndex((p) => p.endsWith(SIDECARS_SUFFIX));
  if (sidecarIdx < 0)
    throw new Error(`No '${SIDECARS_SUFFIX}' component in path: ${sidecarPath}`);

  const relParts = parts.slice(sidecarIdx + 1);
  if (relParts.length === 0)
    throw new Error(`Sidecar path has no segments after directory: ${sidecarPath}`);

  const last = relParts[relParts.length - 1];
  if (!last.endsWith('.md')) throw new Error(`Sidecar file does not end in .md: ${sidecarPath}`);
  relParts[relParts.length - 1] = last.slice(0, -3);

  const pointerSegs = [];
  let node = jsonData;
  for (const seg of relParts) {
    if (Array.isArray(node)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx) || idx < 0 || idx >= node.length)
        throw new Error(`Invalid array index ${seg} for array of length ${node.length}`);
      pointerSegs.push(String(idx));
      node = node[idx];
    } else if (node !== null && typeof node === 'object') {
      if (!(seg in node)) throw new Error(`Key ${JSON.stringify(seg)} not found in JSON object`);
      pointerSegs.push(escapePointerSegment(seg));
      node = node[seg];
    } else {
      throw new Error(`Cannot traverse into ${typeof node} with segment ${JSON.stringify(seg)}`);
    }
  }
  return '/' + pointerSegs.join('/');
}
