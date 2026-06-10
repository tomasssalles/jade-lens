// Wikilink reference scanning and rewriting — a port of jadelens/wikilinks.py
// operating on an in-memory file map (Map<path, content>) instead of the
// filesystem + git.
//
// Wikilinks are `[[path]]`, path relative to the data-repo root (DESIGN §4.3).
// The post-apply pass (workflow.run) rewrites references on rename and verifies
// no dangling references remain on delete.

import { normpath } from './posixPath.js';
import { makeIgnoreMatcher } from './gitignore.js';

const EDITABLE_FILE_SUFFIXES = ['.json', '.md'];

function wikilinkPaths(content) {
  return [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
}

/** Git-visible .json/.md files: editable suffix, not gitignored. */
function scannableFiles(tree) {
  const ig = makeIgnoreMatcher(tree.get('.gitignore'));
  const files = [];
  for (const path of tree.keys()) {
    if (!EDITABLE_FILE_SUFFIXES.some((s) => path.endsWith(s))) continue;
    if (ig.ignores(path)) continue;
    files.push(path);
  }
  return files;
}

// --- logical path comparison (PurePosixPath semantics) ---

function isAncestor(src, link) {
  if (src === link) return false;
  if (src === '.') return link !== '.'; // "." is an ancestor of every other path
  return link.startsWith(src + '/');
}

function relativeTo(link, src) {
  if (src === '.') return link;
  return link.slice(src.length + 1);
}

function joinPath(dst, rel) {
  if (rel === '') return dst;
  if (dst === '.') return rel;
  return dst + '/' + rel;
}

function refersTo(linkPath, target) {
  const link = normpath(linkPath);
  const tgt = normpath(target);
  return link === tgt || isAncestor(tgt, link);
}

function rewriteOne(linkPath, fromPath, toPath) {
  const link = normpath(linkPath);
  const src = normpath(fromPath);
  const dst = normpath(toPath);
  if (link === src) return `[[${dst}]]`;
  if (isAncestor(src, link)) return `[[${joinPath(dst, relativeTo(link, src))}]]`;
  return `[[${linkPath}]]`; // unchanged — preserve the original (possibly denormalised) form
}

/**
 * Rewrite every wikilink whose path is `fromPath` or under it to point at the
 * new location. Mutates `tree`; returns the list of modified file paths.
 */
export function rewriteReferencesUnder(tree, fromPath, toPath) {
  const modified = [];
  for (const path of scannableFiles(tree)) {
    const original = tree.get(path);
    const rewritten = original.replace(/\[\[([^\]]+)\]\]/g, (_m, p1) =>
      rewriteOne(p1, fromPath, toPath),
    );
    if (rewritten !== original) {
      tree.set(path, rewritten);
      modified.push(path);
    }
  }
  return modified;
}

/** Return [file, linkPath] pairs for every wikilink that resolves to a nonexistent file. */
export function findDeadWikilinks(tree) {
  const dead = [];
  for (const path of scannableFiles(tree)) {
    for (const linkPath of wikilinkPaths(tree.get(path))) {
      if (!tree.has(normpath(linkPath))) dead.push([path, linkPath]);
    }
  }
  return dead;
}

/** Return every wikilink pointing at `target` or anything under it. */
export function findReferences(tree, target) {
  const refs = [];
  for (const path of scannableFiles(tree)) {
    for (const linkPath of wikilinkPaths(tree.get(path))) {
      if (refersTo(linkPath, target)) refs.push([path, linkPath]);
    }
  }
  return refs;
}
