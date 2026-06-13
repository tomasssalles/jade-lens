// Batch-level orchestration — port of jadelens/workflow.py, operating on an
// in-memory file map (Map<path, content>).
//
// The git-specific steps of the Python pipeline (require_clean_tree, git
// commit/revert) live in the per-client sync layer, not here: this is the pure,
// substrate-agnostic core the conformance suite validates. `run` works on a
// clone of the input map and returns a new map on success; on any failure it
// throws and the caller's input map is untouched (atomic batch).

import { ApplyError, BatchValidationError } from "./errors.js";
import {
  CreateFile,
  DeletePath,
  RenamePath,
  JsonPatch,
  UnifiedDiff,
  parseOperation,
} from "./operations.js";
import { findDeadWikilinks, rewriteReferencesUnder } from "./wikilinks.js";
import { makeIgnoreMatcher } from "./gitignore.js";
import {
  isPromotable,
  jsonPathFromSidecar,
  pointerToSidecarPath,
  sidecarDirForJson,
  sidecarPathToPointer,
} from "./sidecar.js";
import { normpath } from "./posixPath.js";

// ---------- Batch validation ----------

export function validateBatch(operations) {
  // entries[path] = array of { index, category, summary }
  const entries = new Map();
  const add = (path, index, category, summary) => {
    if (!entries.has(path)) entries.set(path, []);
    entries.get(path).push({ index, category, summary });
  };

  operations.forEach((op, i) => {
    if (op instanceof JsonPatch) add(op.path, i, "modify_json", "json_patch");
    else if (op instanceof UnifiedDiff)
      add(op.path, i, "modify_text", "unified_diff");
    else if (op instanceof CreateFile)
      add(op.path, i, "structure", "create_file");
    else if (op instanceof DeletePath)
      add(op.path, i, "structure", "delete_path");
    else if (op instanceof RenamePath) {
      add(op.fromPath, i, "structure", "rename_path (from)");
      add(op.toPath, i, "structure", "rename_path (to)");
    } else {
      throw new BatchValidationError(
        `Unknown op type at index ${i}`,
        "OP_UNKNOWN_TYPE",
      );
    }
  });

  for (const [path, opsHere] of entries) {
    const categories = new Set(opsHere.map((e) => e.category));
    if (categories.size > 1) {
      const detail = opsHere
        .map((e) => `op ${e.index}: ${e.summary}`)
        .join(", ");
      throw new BatchValidationError(
        `Path ${JSON.stringify(path)} is touched by incompatible op categories in one batch (${detail}). Split into separate batches.`,
        "BATCH_INCOMPATIBLE_CATEGORIES",
      );
    }
    if ([...categories][0] === "structure" && opsHere.length > 1) {
      const detail = opsHere
        .map((e) => `op ${e.index}: ${e.summary}`)
        .join(", ");
      throw new BatchValidationError(
        `Path ${JSON.stringify(path)} is touched by multiple structure ops in one batch (${detail}). ` +
          `Only one of create_file / delete_path / rename_path is allowed per path per batch.`,
        "BATCH_MULTIPLE_STRUCTURE_OPS",
      );
    }
  }
}

// ---------- Unified-diff merging ----------

function stripDiffPreamble(diffText) {
  const lines = diffText.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("@@")) i++;
  return lines.slice(i).join("\n");
}

export function mergeUnifiedDiffs(operations) {
  const diffsByPath = new Map();
  for (const op of operations) {
    if (op instanceof UnifiedDiff) {
      if (!diffsByPath.has(op.path)) diffsByPath.set(op.path, []);
      diffsByPath.get(op.path).push(op);
    }
  }

  let anyMultiple = false;
  for (const list of diffsByPath.values()) {
    if (list.length > 1) anyMultiple = true;
  }
  if (!anyMultiple) return operations;

  const emitted = new Set();
  const merged = [];
  for (const op of operations) {
    if (op instanceof UnifiedDiff && diffsByPath.get(op.path).length > 1) {
      if (emitted.has(op.path)) continue;
      emitted.add(op.path);
      const combined =
        diffsByPath
          .get(op.path)
          .map((d) => stripDiffPreamble(d.diff).replace(/\n+$/, ""))
          .join("\n") + "\n";
      merged.push(new UnifiedDiff(op.path, combined));
    } else {
      merged.push(op);
    }
  }
  return merged;
}

// ---------- Operations log ----------

const SUPPORTED_DATA_FORMAT_VERSION = "v2";

function appendLogEntry(tree, rawOperations, commitMessage, timestamp) {
  const logPath = `.jade/operations-log/${SUPPORTED_DATA_FORMAT_VERSION}.jsonl`;
  const existing = tree.get(logPath) ?? "";
  const entry = {
    ts: timestamp,
    commit_message: commitMessage,
    operations: rawOperations,
  };
  tree.set(logPath, existing + JSON.stringify(entry) + "\n");
}

// ---------- Post-apply index pass ----------

function appendIndexEntry(tree, path, scope) {
  const normalized = normpath(path);
  const entry = { File: `[[${normalized}]]`, Scope: scope };
  let entries = [];
  if (tree.has('Index.json')) {
    try {
      const parsed = JSON.parse(tree.get('Index.json'));
      if (Array.isArray(parsed)) entries = parsed;
    } catch { /* treat malformed as empty */ }
  }
  entries.push(entry);
  tree.set('Index.json', JSON.stringify(entries, null, 2) + '\n');
}

function postApplyIndexPass(tree, operations) {
  for (const op of operations) {
    if (op instanceof CreateFile && op.indexed) {
      appendIndexEntry(tree, op.path, op.scope);
    }
  }
}

// ---------- Post-apply wikilink pass ----------

function postApplyWikilinkPass(tree, operations) {
  for (const op of operations) {
    if (op instanceof RenamePath) {
      rewriteReferencesUnder(tree, op.fromPath, op.toPath);
    }
  }
  // Dead-wikilink checking (including after deletes) is handled by
  // the subsequent enforcement pass.
}

// ---------- Post-apply enforcement pass ----------

const INDEX_ENTRY_WIKILINK_RE = /^\[\[(.+)\]\]$/;
const INDEX_EXCLUDED_PATHS = new Set(['Index.json', 'CLAUDE.md']);
const SIDECARS_SUFFIX = '.sidecars';

/** Return true if path is inside a .sidecars directory. */
function isSidecarPath(path) {
  return path.split('/').some((part) => part.endsWith(SIDECARS_SUFFIX));
}

function fileStem(filename) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function userFiles(tree) {
  const ig = makeIgnoreMatcher(tree.get('.gitignore'));
  const files = [];
  for (const path of tree.keys()) {
    if (path.split('/')[0].startsWith('.')) continue;
    if (isSidecarPath(path)) continue;
    if (!path.endsWith('.json') && !path.endsWith('.md')) continue;
    if (ig.ignores(path)) continue;
    files.push(path);
  }
  return files;
}

function enforceIndexFormat(tree) {
  if (!tree.has('Index.json')) return null;
  let parsed;
  try {
    parsed = JSON.parse(tree.get('Index.json'));
  } catch (e) {
    throw new ApplyError(`Index.json is not valid JSON: ${e.message}`, 'INDEX_MALFORMED');
  }
  if (!Array.isArray(parsed)) {
    throw new ApplyError('Index.json must be a JSON array', 'INDEX_MALFORMED');
  }
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ApplyError(`Index.json entry ${i} is not an object`, 'INDEX_MALFORMED');
    }
    const fileVal = entry.File;
    if (typeof fileVal !== 'string') {
      throw new ApplyError(`Index.json entry ${i}: 'File' must be a string`, 'INDEX_MALFORMED');
    }
    const m = INDEX_ENTRY_WIKILINK_RE.exec(fileVal);
    if (!m) {
      throw new ApplyError(
        `Index.json entry ${i}: 'File' must be a wikilink [[...]], got ${JSON.stringify(fileVal)}`,
        'INDEX_MALFORMED',
      );
    }
    const linkedPath = m[1];
    if (linkedPath.split('/')[0].startsWith('.')) {
      throw new ApplyError(
        `Index.json entry ${i}: 'File' ${JSON.stringify(fileVal)} references a protected path; excluded paths cannot be indexed`,
        'INDEX_MALFORMED',
      );
    }
    if (INDEX_EXCLUDED_PATHS.has(linkedPath) || isSidecarPath(linkedPath)) {
      throw new ApplyError(
        `Index.json entry ${i}: 'File' ${JSON.stringify(fileVal)} is not allowed in the index`,
        'INDEX_MALFORMED',
      );
    }
    const scopeVal = entry.Scope;
    if (typeof scopeVal !== 'string' || !scopeVal.trim()) {
      throw new ApplyError(
        `Index.json entry ${i}: 'Scope' must be a non-empty string`,
        'INDEX_MALFORMED',
      );
    }
  }
  return parsed;
}

function enforceIndexNoDuplicates(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const fileVal = entry.File;
    if (seen.has(fileVal)) {
      throw new ApplyError(
        `Index.json has duplicate File entry: ${JSON.stringify(fileVal)}`,
        'INDEX_DUPLICATE_FILE',
      );
    }
    seen.add(fileVal);
  }
}

function enforceIndexCompleteness(files, entries) {
  const indexedPaths = new Set(
    entries.map((e) => normpath(INDEX_ENTRY_WIKILINK_RE.exec(e.File)[1])),
  );
  for (const path of files) {
    const p = normpath(path);
    if (INDEX_EXCLUDED_PATHS.has(p)) continue;
    if (!indexedPaths.has(p)) {
      throw new ApplyError(
        `File ${JSON.stringify(path)} is not listed in Index.json`,
        'INDEX_MISSING_ENTRY',
      );
    }
  }
}

function enforceNoStemDirCollision(files) {
  const parentFileStems = new Map(); // parent -> Set of file stems
  const parentDirNames = new Map();  // parent -> Set of subdir names

  const addToMap = (map, key, val) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(val);
  };

  for (const path of files) {
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    addToMap(parentFileStems, parent, fileStem(filename));
    for (let i = 0; i < parts.length - 1; i++) {
      const grandparent = i > 0 ? parts.slice(0, i).join('/') : '.';
      addToMap(parentDirNames, grandparent, parts[i]);
    }
  }

  for (const [parent, stems] of parentFileStems) {
    const dirs = parentDirNames.get(parent);
    if (!dirs) continue;
    for (const stem of stems) {
      if (dirs.has(stem)) {
        throw new ApplyError(
          `File stem collides with directory name in ${JSON.stringify(parent)}: ${JSON.stringify(stem)}`,
          'STEM_DIR_COLLISION',
        );
      }
    }
  }
}

function enforceSidecarOwnerExists(tree) {
  const allPaths = new Set(tree.keys());
  const checked = new Set();
  for (const path of tree.keys()) {
    if (!isSidecarPath(path)) continue;
    let jsonPath;
    try { jsonPath = jsonPathFromSidecar(path); } catch { continue; }
    if (checked.has(jsonPath)) continue;
    checked.add(jsonPath);
    if (!allPaths.has(jsonPath)) {
      throw new ApplyError(
        `Sidecar path ${JSON.stringify(path)} requires ${JSON.stringify(jsonPath)} to exist, but it does not`,
        'SIDECAR_OWNER_MISSING',
      );
    }
  }
}

function enforceSidecarOnlyMd(tree) {
  for (const path of tree.keys()) {
    if (isSidecarPath(path) && !path.endsWith('.md')) {
      throw new ApplyError(
        `Non-.md file inside a sidecar directory: ${JSON.stringify(path)}`,
        'SIDECAR_NON_MD_FILE',
      );
    }
  }
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function getAtJsonPointer(data, pointer) {
  let node = data;
  for (const seg of pointer.slice(1).split('/')) {
    const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) {
      const idx = parseInt(key, 10);
      node = !isNaN(idx) && idx >= 0 && idx < node.length ? node[idx] : undefined;
    } else if (node !== null && typeof node === 'object') {
      node = Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined;
    } else {
      return undefined;
    }
    if (node === undefined) return undefined;
  }
  return node;
}

function enforceSidecarIntegrity(tree) {
  const sidecarPaths = [];
  for (const path of tree.keys()) {
    if (isSidecarPath(path) && path.endsWith('.md')) sidecarPaths.push(path);
  }
  const sidecarPathSet = new Set(sidecarPaths);

  const ownerDataCache = new Map();
  const loadOwner = (jsonPath) => {
    if (!ownerDataCache.has(jsonPath)) {
      const content = tree.get(jsonPath);
      if (content === undefined) { ownerDataCache.set(jsonPath, null); return null; }
      try { ownerDataCache.set(jsonPath, JSON.parse(content)); }
      catch { ownerDataCache.set(jsonPath, null); }
    }
    return ownerDataCache.get(jsonPath);
  };

  // 5f-iii
  for (const sidecarPath of sidecarPaths) {
    let jsonPath;
    try { jsonPath = jsonPathFromSidecar(sidecarPath); } catch { continue; }
    const data = loadOwner(jsonPath);
    if (data === null) continue; // caught by 5f-i

    let pointer;
    try { pointer = sidecarPathToPointer(sidecarPath, data); }
    catch (e) {
      throw new ApplyError(
        `Sidecar ${JSON.stringify(sidecarPath)} has no corresponding field in ${JSON.stringify(jsonPath)}: ${e.message}`,
        'SIDECAR_FIELD_MISSING',
      );
    }

    const actual = getAtJsonPointer(data, pointer);
    const expected = `[[${sidecarPath}]]`;
    if (actual !== expected) {
      throw new ApplyError(
        `Sidecar ${JSON.stringify(sidecarPath)}: ${JSON.stringify(jsonPath)} at ${JSON.stringify(pointer)} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual ?? null)}`,
        'SIDECAR_WIKILINK_MISSING',
      );
    }
  }

  // 5f-iv
  const occurrences = new Map();
  for (const [path, content] of tree.entries()) {
    if (!path.endsWith('.json') && !path.endsWith('.md')) continue;
    for (const m of content.matchAll(new RegExp(WIKILINK_RE.source, 'g'))) {
      const linkPath = m[1];
      if (!sidecarPathSet.has(linkPath)) continue;
      let owner;
      try { owner = jsonPathFromSidecar(linkPath); } catch { continue; }
      if (path !== owner) {
        throw new ApplyError(
          `Sidecar wikilink [[${linkPath}]] found in ${JSON.stringify(path)}; only ${JSON.stringify(owner)} may reference it`,
          'SIDECAR_WIKILINK_WRONG_FILE',
        );
      }
      occurrences.set(linkPath, (occurrences.get(linkPath) ?? 0) + 1);
    }
  }

  for (const [sidecarPath, count] of occurrences.entries()) {
    if (count > 1) {
      const owner = jsonPathFromSidecar(sidecarPath);
      throw new ApplyError(
        `Sidecar wikilink [[${sidecarPath}]] appears ${count} times in ${JSON.stringify(owner)}; only one occurrence is allowed`,
        'SIDECAR_WIKILINK_DUPLICATE',
      );
    }
  }
}

function postApplyEnforcementPass(tree) {
  const files = userFiles(tree);
  const indexEntries = enforceIndexFormat(tree);
  const entries = indexEntries !== null ? indexEntries : [];
  enforceIndexNoDuplicates(entries);
  enforceIndexCompleteness(files, entries);
  enforceNoStemDirCollision(files);
  enforceSidecarOwnerExists(tree);
  enforceSidecarOnlyMd(tree);
  enforceSidecarIntegrity(tree);
  const dead = findDeadWikilinks(tree);
  if (dead.length) {
    const detail = dead.map(([f, p]) => `${f}: [[${p}]]`).join('; ');
    const err = new ApplyError(
      `Wikilinks resolve to nonexistent files:\n  ${detail}`,
      'WIKILINK_DEAD',
    );
    err.references = dead; // structured list for UI surfacing ([file, linkPath] pairs)
    throw err;
  }
}

// ---------- Post-apply sidecar propagation pass ----------


function postApplySidecarPropagationPass(tree, operations) {
  for (const op of operations) {
    // 6b: delete_path on .json also deletes its .sidecars/ directory
    if (op instanceof DeletePath && op.path.endsWith('.json')) {
      const sidecarDir = sidecarDirForJson(op.path);
      const prefix = sidecarDir + '/';
      for (const k of [...tree.keys()]) {
        if (k.startsWith(prefix)) tree.delete(k);
      }
    }

    // 6c: json_patch move ops also move their sidecar subtrees
    if (op instanceof JsonPatch) {
      for (const patchOp of op.patch) {
        if (patchOp.op !== 'move') continue;
        const fromPtr = patchOp.from ?? '';
        const toPtr = patchOp.path ?? '';
        if (!fromPtr.startsWith('/') || !toPtr.startsWith('/')) continue;
        if (fromPtr.slice(1).split('/').includes('-') ||
            toPtr.slice(1).split('/').includes('-')) continue;
        let fromSidecar, toSidecar;
        try {
          fromSidecar = pointerToSidecarPath(op.path, fromPtr);
          toSidecar = pointerToSidecarPath(op.path, toPtr);
        } catch { continue; }
        if (fromSidecar === toSidecar) continue;
        const fromBase = fromSidecar.slice(0, -3); // strip .md
        const toBase = toSidecar.slice(0, -3);
        // Move the .md sidecar file (overwrite target if it exists)
        if (tree.has(fromSidecar)) {
          tree.set(toSidecar, tree.get(fromSidecar));
          tree.delete(fromSidecar);
          rewriteReferencesUnder(tree, fromSidecar, toSidecar);
        }
        // Move nested sidecar subtree (object/array fields)
        const fromDir = fromBase + '/';
        const toDir = toBase + '/';
        const subKeys = [...tree.keys()].filter((k) => k.startsWith(fromDir));
        if (subKeys.length > 0) {
          for (const k of subKeys) {
            tree.set(toDir + k.slice(fromDir.length), tree.get(k));
            tree.delete(k);
          }
          rewriteReferencesUnder(tree, fromBase, toBase);
        }
      }

      // 6d: remove sub-ops delete the corresponding sidecar file/subtree
      for (const patchOp of op.patch) {
        if (patchOp.op !== 'remove') continue;
        const ptr = patchOp.path ?? '';
        if (!ptr.startsWith('/') || ptr.slice(1).split('/').includes('-')) continue;
        let sidecarFile;
        try { sidecarFile = pointerToSidecarPath(op.path, ptr); }
        catch { continue; }
        const sidecarBase = sidecarFile.slice(0, -3); // strip .md → dir for nested fields
        const sidecarBaseDir = sidecarBase + '/';
        if (tree.has(sidecarFile)) tree.delete(sidecarFile);
        for (const k of [...tree.keys()]) {
          if (k.startsWith(sidecarBaseDir)) tree.delete(k);
        }
      }
    }

    // 6a: rename_path on .json also renames its .sidecars/ directory
    if (op instanceof RenamePath && op.fromPath.endsWith('.json')) {
      const fromSidecarDir = sidecarDirForJson(op.fromPath);
      const toSidecarDir = sidecarDirForJson(op.toPath);
      const prefix = fromSidecarDir + '/';
      const sidecarKeys = [...tree.keys()].filter((k) => k.startsWith(prefix));
      if (sidecarKeys.length === 0) continue;
      for (const k of sidecarKeys) {
        tree.set(toSidecarDir + '/' + k.slice(prefix.length), tree.get(k));
        tree.delete(k);
      }
      rewriteReferencesUnder(tree, fromSidecarDir, toSidecarDir);
    }
  }
}

// ---------- Pre-apply sidecar promotion pass ----------

function resolveJsonPointer(pointer, data) {
  if (!pointer.startsWith('/')) return pointer;
  const segments = pointer.slice(1).split('/');
  const resolved = [];
  let node = data;
  for (const seg of segments) {
    if (seg === '-' && Array.isArray(node)) {
      resolved.push(String(node.length));
      node = null;
    } else {
      const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
      resolved.push(seg);
      if (Array.isArray(node)) {
        const idx = parseInt(key, 10);
        node = !isNaN(idx) && idx >= 0 && idx < node.length ? node[idx] : null;
      } else if (node !== null && typeof node === 'object') {
        node = Object.prototype.hasOwnProperty.call(node, key) ? node[key] : null;
      } else {
        node = null;
      }
    }
  }
  return '/' + resolved.join('/');
}

function preApplySidecarPromotionPass(tree, operations) {
  const promotedOps = [];
  const newSidecars = [];

  for (let op of operations) {
    if (op instanceof JsonPatch) {
      let current = null;
      if (tree.has(op.path)) {
        try { current = JSON.parse(tree.get(op.path)); } catch { /* treat as null */ }
      }

      const newPatch = [...op.patch];
      let changed = false;
      for (let j = 0; j < newPatch.length; j++) {
        const patchOp = newPatch[j];
        if (patchOp.op !== 'add' && patchOp.op !== 'replace') continue;
        const value = patchOp.value;
        if (typeof value !== 'string') continue;
        if (value.startsWith('[[') && value.endsWith(']]')) continue;
        if (!isPromotable(value)) continue;

        const pointer = patchOp.path ?? '';
        const resolved = current !== null ? resolveJsonPointer(pointer, current) : pointer;
        let sidecarPath;
        try {
          sidecarPath = pointerToSidecarPath(op.path, resolved);
        } catch {
          continue;
        }

        newPatch[j] = { ...patchOp, value: `[[${sidecarPath}]]` };
        newSidecars.push({ path: sidecarPath, content: value });
        changed = true;
      }

      if (changed) op = new JsonPatch(op.path, newPatch);
    }
    promotedOps.push(op);
  }

  return { promotedOps, newSidecars };
}

// ---------- Orchestration ----------

/**
 * Execute the mutation pipeline against a file map.
 *
 * @param {Map<string,string>} tree - the current file map (not mutated).
 * @param {Array<object>} rawOperations - raw operation objects (as the bot/UI emits).
 * @param {string} commitMessage
 * @param {{timestamp?: string}} [opts] - override the log timestamp (for tests).
 * @returns {Map<string,string>} a new file map with the batch applied.
 * @throws {ConformanceError} on validation or application failure (input untouched).
 */
export function run(tree, rawOperations, commitMessage, opts = {}) {
  const operations = rawOperations.map(parseOperation);
  validateBatch(operations);
  const effective = mergeUnifiedDiffs(operations);

  const work = new Map(tree); // values are immutable strings; shallow clone is safe
  const { promotedOps, newSidecars } = preApplySidecarPromotionPass(work, effective);
  for (const { path, content } of newSidecars) work.set(path, content);
  for (const op of promotedOps) op.apply(work);
  postApplySidecarPropagationPass(work, effective);
  postApplyWikilinkPass(work, effective);
  postApplyIndexPass(work, effective);
  postApplyEnforcementPass(work);

  const timestamp = opts.timestamp ?? new Date().toISOString();
  appendLogEntry(work, rawOperations, commitMessage, timestamp);
  return work;
}
