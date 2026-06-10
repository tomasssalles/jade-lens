// Typed operations: parse + apply against an in-memory file map
// (Map<path, content>). Port of jadelens/operations.py. `apply` mutates the
// passed map; the workflow orchestrator works on a clone so a failure leaves
// the input untouched (atomic batch).

import { ValidationError, ApplyError } from './errors.js';
import { normpath, suffix, firstComponent } from './posixPath.js';
import { applyJsonPatch, JsonPatchError } from './jsonPatch.js';
import {
  applyUnifiedDiff,
  DiffParseError,
  DiffApplyError,
} from './unifiedDiff.js';

export const EDITABLE_FILE_SUFFIXES = ['.json', '.md'];

// --- file-map helpers (a "directory" exists iff some key is under it) ---

function isFile(tree, path) {
  return tree.has(path);
}

function isDir(tree, path) {
  const prefix = path + '/';
  for (const key of tree.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function pathExists(tree, path) {
  return isFile(tree, path) || isDir(tree, path);
}

// --- operation types ---

export class CreateFile {
  constructor(path, content, indexed = false, scope = null) {
    this.path = path;
    this.content = content;
    this.indexed = indexed;
    this.scope = scope;
  }

  apply(tree) {
    const key = normpath(this.path);
    if (pathExists(tree, key)) {
      throw new ApplyError(`create_file: target already exists: ${this.path}`, 'TARGET_EXISTS');
    }
    tree.set(key, this.content);
    if (this.indexed) {
      _appendIndexEntry(tree, this.path, this.scope);
    }
  }
}

function _appendIndexEntry(tree, path, scope) {
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

export class DeletePath {
  constructor(path) {
    this.path = path;
  }

  apply(tree) {
    const key = normpath(this.path);
    if (!pathExists(tree, key)) {
      throw new ApplyError(`delete_path: target does not exist: ${this.path}`, 'TARGET_NOT_FOUND');
    }
    tree.delete(key);
    const prefix = key + '/';
    for (const k of [...tree.keys()]) {
      if (k.startsWith(prefix)) tree.delete(k);
    }
  }
}

export class RenamePath {
  constructor(fromPath, toPath) {
    this.fromPath = fromPath;
    this.toPath = toPath;
  }

  apply(tree) {
    const from = normpath(this.fromPath);
    const to = normpath(this.toPath);
    if (!pathExists(tree, from)) {
      throw new ApplyError(`rename_path: source does not exist: ${this.fromPath}`, 'TARGET_NOT_FOUND');
    }
    if (pathExists(tree, to)) {
      throw new ApplyError(`rename_path: target already exists: ${this.toPath}`, 'TARGET_EXISTS');
    }
    if (isFile(tree, from)) {
      // File rename: the suffix must be preserved (no type-changing renames).
      if (suffix(from) !== suffix(to)) {
        throw new ApplyError(
          `rename_path: file suffix must be preserved ` +
            `(source ${JSON.stringify(suffix(from))}, target ${JSON.stringify(suffix(to))})`,
          'RENAME_SUFFIX_CHANGED',
        );
      }
      tree.set(to, tree.get(from));
      tree.delete(from);
    } else {
      // Directory rename: move every file beneath it.
      const prefix = from + '/';
      for (const k of [...tree.keys()]) {
        if (k.startsWith(prefix)) {
          tree.set(to + '/' + k.slice(prefix.length), tree.get(k));
          tree.delete(k);
        }
      }
    }
  }
}

export class JsonPatch {
  constructor(path, patch) {
    this.path = path;
    this.patch = patch;
  }

  apply(tree) {
    const key = normpath(this.path);
    if (!pathExists(tree, key)) {
      throw new ApplyError(`json_patch: target file does not exist: ${this.path}`, 'TARGET_NOT_FOUND');
    }
    if (!isFile(tree, key)) {
      throw new ApplyError(`json_patch: target is not a file: ${this.path}`, 'TARGET_NOT_A_FILE');
    }

    let original;
    try {
      original = JSON.parse(tree.get(key));
    } catch (e) {
      throw new ApplyError(
        `json_patch: target ${this.path} is not valid JSON: ${e.message}`,
        'JSON_PATCH_TARGET_INVALID_JSON',
      );
    }

    let result;
    try {
      result = applyJsonPatch(original, this.patch);
    } catch (e) {
      if (e instanceof JsonPatchError) {
        throw new ApplyError(
          `json_patch: failed to apply patch on ${this.path}: ${e.message}`,
          'JSON_PATCH_APPLY_FAILED',
        );
      }
      throw e;
    }

    // Canonical JS-faithful serialisation (conformance/README.md §3–§4).
    tree.set(key, JSON.stringify(result, null, 2) + '\n');
  }
}

export class UnifiedDiff {
  constructor(path, diff) {
    this.path = path;
    this.diff = diff;
  }

  apply(tree) {
    const key = normpath(this.path);
    if (!pathExists(tree, key)) {
      throw new ApplyError(`unified_diff: target file does not exist: ${this.path}`, 'TARGET_NOT_FOUND');
    }
    if (!isFile(tree, key)) {
      throw new ApplyError(`unified_diff: target is not a file: ${this.path}`, 'TARGET_NOT_A_FILE');
    }

    const original = tree.get(key);
    let newContent;
    try {
      newContent = applyUnifiedDiff(original, this.diff);
    } catch (e) {
      if (e instanceof DiffParseError) {
        throw new ApplyError(
          `unified_diff: parse error on ${this.path}: ${e.message}`,
          'UNIFIED_DIFF_PARSE_FAILED',
        );
      }
      if (e instanceof DiffApplyError) {
        throw new ApplyError(
          `unified_diff: apply failed on ${this.path}: ${e.message}`,
          'UNIFIED_DIFF_APPLY_FAILED',
        );
      }
      throw e;
    }

    tree.set(key, newContent);
  }
}

// --- parsing ---

function jsType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function parseOperation(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`Operation must be a JSON object, got ${jsType(raw)}`, 'OP_NOT_OBJECT');
  }
  const opType = raw.op;
  if (opType === undefined || opType === null) {
    throw new ValidationError("Operation missing 'op' field", 'OP_MISSING_OP_FIELD');
  }
  switch (opType) {
    case 'create_file':
      return parseCreateFile(raw);
    case 'delete_path':
      return parseDeletePath(raw);
    case 'rename_path':
      return parseRenamePath(raw);
    case 'json_patch':
      return parseJsonPatch(raw);
    case 'unified_diff':
      return parseUnifiedDiff(raw);
    default:
      throw new ValidationError(
        `Unknown op type ${JSON.stringify(opType)}. Allowed: ` +
          `["create_file","delete_path","json_patch","rename_path","unified_diff"]`,
        'OP_UNKNOWN_TYPE',
      );
  }
}

function parseCreateFile(raw) {
  const REQUIRED = ['op', 'path', 'content'];
  const ALLOWED = new Set([...REQUIRED, 'indexed', 'scope']);
  const keys = Object.keys(raw);
  const missing = REQUIRED.filter((k) => !Object.hasOwn(raw, k));
  const extra = keys.filter((k) => !ALLOWED.has(k));
  if (missing.length) {
    throw new ValidationError(
      `Operation ${JSON.stringify(raw.op)} missing required keys: ${JSON.stringify(missing.sort())}`,
      'OP_MISSING_KEYS',
    );
  }
  if (extra.length) {
    throw new ValidationError(
      `Operation ${JSON.stringify(raw.op)} has unexpected keys: ${JSON.stringify(extra.sort())}`,
      'OP_UNEXPECTED_KEYS',
    );
  }
  const path = requireStr(raw, 'path');
  rejectProtectedPath(path);
  if (!EDITABLE_FILE_SUFFIXES.some((s) => path.endsWith(s))) {
    throw new ValidationError(
      `create_file path must end with one of ${JSON.stringify(EDITABLE_FILE_SUFFIXES)} (got ${JSON.stringify(path)})`,
      'CREATE_FILE_BAD_SUFFIX',
    );
  }
  const content = requireStr(raw, 'content');
  if (path.endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (e) {
      throw new ValidationError(
        `create_file content for ${JSON.stringify(path)} is not valid JSON: ${e.message}`,
        'CREATE_FILE_INVALID_JSON',
      );
    }
  }
  const indexed = Object.hasOwn(raw, 'indexed') ? raw.indexed : false;
  if (typeof indexed !== 'boolean') {
    throw new ValidationError(
      `Field "indexed" must be a boolean, got ${jsType(indexed)}`,
      'OP_WRONG_FIELD_TYPE',
    );
  }
  const scope = Object.hasOwn(raw, 'scope') ? raw.scope : null;
  if (scope !== null && typeof scope !== 'string') {
    throw new ValidationError(
      `Field "scope" must be a string or null, got ${jsType(scope)}`,
      'OP_WRONG_FIELD_TYPE',
    );
  }
  if (indexed && !scope) {
    throw new ValidationError(
      "create_file: 'scope' must be a non-empty string when 'indexed' is true",
      'CREATE_FILE_BAD_INDEXED_SCOPE',
    );
  }
  if (!indexed && scope !== null) {
    throw new ValidationError(
      "create_file: 'scope' must be null when 'indexed' is false",
      'CREATE_FILE_BAD_INDEXED_SCOPE',
    );
  }
  return new CreateFile(path, content, indexed, scope);
}

function parseDeletePath(raw) {
  requireExactKeys(raw, ['op', 'path']);
  const path = requireStr(raw, 'path');
  rejectProtectedPath(path);
  return new DeletePath(path);
}

function parseRenamePath(raw) {
  requireExactKeys(raw, ['op', 'from', 'to']);
  const fromPath = requireStr(raw, 'from');
  const toPath = requireStr(raw, 'to');
  rejectProtectedPath(fromPath, 'from');
  rejectProtectedPath(toPath, 'to');
  return new RenamePath(fromPath, toPath);
}

function parseJsonPatch(raw) {
  requireExactKeys(raw, ['op', 'path', 'patch']);
  const path = requireStr(raw, 'path');
  rejectProtectedPath(path);
  if (!path.endsWith('.json')) {
    throw new ValidationError(
      `json_patch path must end with '.json' (got ${JSON.stringify(path)}); use unified_diff for non-JSON files`,
      'JSON_PATCH_WRONG_SUFFIX',
    );
  }
  const patch = raw.patch;
  if (!Array.isArray(patch)) {
    throw new ValidationError(
      `json_patch 'patch' must be a list, got ${jsType(patch)}`,
      'OP_WRONG_FIELD_TYPE',
    );
  }
  return new JsonPatch(path, patch);
}

function parseUnifiedDiff(raw) {
  requireExactKeys(raw, ['op', 'path', 'diff']);
  const path = requireStr(raw, 'path');
  rejectProtectedPath(path);
  if (path.endsWith('.json')) {
    throw new ValidationError(
      `unified_diff cannot target JSON files (got ${JSON.stringify(path)}); use json_patch for .json files`,
      'UNIFIED_DIFF_WRONG_SUFFIX',
    );
  }
  return new UnifiedDiff(path, requireStr(raw, 'diff'));
}

// --- validation helpers ---

function rejectProtectedPath(path, field = 'path') {
  const first = firstComponent(path);
  if (first !== undefined && first.startsWith('.')) {
    throw new ValidationError(
      `${field} ${JSON.stringify(path)} targets a protected top-level path. ` +
        `Anything starting with '.' (.claude/, .git/, .gitignore, .jade/, ...) is reserved for tooling.`,
      'PROTECTED_PATH',
    );
  }
}

function requireExactKeys(raw, allowed) {
  const allowedSet = new Set(allowed);
  const keys = Object.keys(raw);
  const missing = allowed.filter((k) => !Object.hasOwn(raw, k));
  const extra = keys.filter((k) => !allowedSet.has(k));
  if (missing.length) {
    throw new ValidationError(
      `Operation ${JSON.stringify(raw.op)} missing required keys: ${JSON.stringify(missing.sort())}`,
      'OP_MISSING_KEYS',
    );
  }
  if (extra.length) {
    throw new ValidationError(
      `Operation ${JSON.stringify(raw.op)} has unexpected keys: ${JSON.stringify(extra.sort())}`,
      'OP_UNEXPECTED_KEYS',
    );
  }
}

function requireStr(raw, key) {
  const value = raw[key];
  if (typeof value !== 'string') {
    throw new ValidationError(
      `Field ${JSON.stringify(key)} must be a string, got ${jsType(value)}`,
      'OP_WRONG_FIELD_TYPE',
    );
  }
  return value;
}
