// A small, self-contained RFC 6902 (JSON Patch) applier + RFC 6901 (JSON
// Pointer) parser. Hand-rolled to keep the shared mutation core dependency-free
// and to give precise control over failure behaviour (every application error
// becomes a JsonPatchError, which operations.js maps to JSON_PATCH_APPLY_FAILED,
// matching the Python pipeline's jsonpatch-backed behaviour).
//
// Byte-parity of the *result* is guaranteed by the caller serialising with
// `JSON.stringify(result, null, 2) + "\n"` (the canonical form Python matches).

export class JsonPatchError extends Error {}

function unescapeToken(token) {
  // RFC 6901: ~1 → "/", then ~0 → "~".
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parsePointer(pointer) {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new JsonPatchError(`Invalid JSON Pointer: ${JSON.stringify(pointer)}`);
  }
  return pointer.split('/').slice(1).map(unescapeToken);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function arrayIndex(token, length, allowDash) {
  if (allowDash && token === '-') return length;
  if (!/^(0|[1-9][0-9]*)$/.test(token)) {
    throw new JsonPatchError(`Invalid array index: ${JSON.stringify(token)}`);
  }
  return Number(token);
}

/** Navigate to the container holding the final token. */
function resolveParent(doc, tokens) {
  let cur = doc;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (Array.isArray(cur)) {
      const idx = arrayIndex(t, cur.length, false);
      if (idx < 0 || idx >= cur.length) {
        throw new JsonPatchError(`Array index out of bounds: ${t}`);
      }
      cur = cur[idx];
    } else if (cur !== null && typeof cur === 'object') {
      if (!Object.hasOwn(cur, t)) {
        throw new JsonPatchError(`Path segment not found: ${JSON.stringify(t)}`);
      }
      cur = cur[t];
    } else {
      throw new JsonPatchError('Cannot traverse into a non-container value');
    }
  }
  return cur;
}

function getAt(doc, tokens) {
  let cur = doc;
  for (const t of tokens) {
    if (Array.isArray(cur)) {
      const idx = arrayIndex(t, cur.length, false);
      if (idx < 0 || idx >= cur.length) {
        throw new JsonPatchError(`Array index out of bounds: ${t}`);
      }
      cur = cur[idx];
    } else if (cur !== null && typeof cur === 'object') {
      if (!Object.hasOwn(cur, t)) {
        throw new JsonPatchError(`Path not found: ${JSON.stringify(t)}`);
      }
      cur = cur[t];
    } else {
      throw new JsonPatchError('Cannot traverse into a non-container value');
    }
  }
  return cur;
}

function opAdd(doc, tokens, value) {
  if (tokens.length === 0) return clone(value);
  const parent = resolveParent(doc, tokens);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const idx = arrayIndex(key, parent.length, true);
    if (idx < 0 || idx > parent.length) {
      throw new JsonPatchError(`Array index out of bounds: ${key}`);
    }
    parent.splice(idx, 0, clone(value));
  } else if (parent !== null && typeof parent === 'object') {
    parent[key] = clone(value);
  } else {
    throw new JsonPatchError('Cannot add to a non-container value');
  }
  return doc;
}

function opRemove(doc, tokens) {
  if (tokens.length === 0) return null;
  const parent = resolveParent(doc, tokens);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const idx = arrayIndex(key, parent.length, false);
    if (idx < 0 || idx >= parent.length) {
      throw new JsonPatchError(`Array index out of bounds: ${key}`);
    }
    parent.splice(idx, 1);
  } else if (parent !== null && typeof parent === 'object') {
    if (!Object.hasOwn(parent, key)) {
      throw new JsonPatchError(`Path not found: ${JSON.stringify(key)}`);
    }
    delete parent[key];
  } else {
    throw new JsonPatchError('Cannot remove from a non-container value');
  }
  return doc;
}

function opReplace(doc, tokens, value) {
  if (tokens.length === 0) return clone(value);
  const parent = resolveParent(doc, tokens);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const idx = arrayIndex(key, parent.length, false);
    if (idx < 0 || idx >= parent.length) {
      throw new JsonPatchError(`Array index out of bounds: ${key}`);
    }
    parent[idx] = clone(value);
  } else if (parent !== null && typeof parent === 'object') {
    if (!Object.hasOwn(parent, key)) {
      throw new JsonPatchError(`Path not found: ${JSON.stringify(key)}`);
    }
    parent[key] = clone(value);
  } else {
    throw new JsonPatchError('Cannot replace within a non-container value');
  }
  return doc;
}

function applyOne(doc, op) {
  switch (op.op) {
    case 'add':
      return opAdd(doc, parsePointer(op.path), op.value);
    case 'remove':
      return opRemove(doc, parsePointer(op.path));
    case 'replace':
      return opReplace(doc, parsePointer(op.path), op.value);
    case 'test': {
      const actual = getAt(doc, parsePointer(op.path));
      if (!deepEqual(actual, op.value)) {
        throw new JsonPatchError('test operation failed');
      }
      return doc;
    }
    case 'move': {
      const fromTokens = parsePointer(op.from);
      const value = getAt(doc, fromTokens);
      const removed = opRemove(doc, fromTokens);
      return opAdd(removed, parsePointer(op.path), value);
    }
    case 'copy': {
      const value = getAt(doc, parsePointer(op.from));
      return opAdd(doc, parsePointer(op.path), clone(value));
    }
    default:
      throw new JsonPatchError(`Unknown JSON Patch op: ${JSON.stringify(op.op)}`);
  }
}

/**
 * Apply an RFC 6902 patch (array of ops) to `document`, returning the result.
 * The input is never mutated. Throws JsonPatchError on any failure.
 */
export function applyJsonPatch(document, patch) {
  let doc = clone(document);
  for (const op of patch) {
    if (op === null || typeof op !== 'object' || Array.isArray(op)) {
      throw new JsonPatchError('Each patch entry must be an object');
    }
    doc = applyOne(doc, op);
  }
  return doc;
}
