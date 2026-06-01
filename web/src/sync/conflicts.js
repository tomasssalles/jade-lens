// File-level conflict detection (Phase 2 of
// docs/mutation-sync-implementation-plan.md; design in docs/sync-and-conflicts.md
// §3). Pure logic — no network, no git, no IndexedDB.
//
// A conflict is when sync pulls a remote change to a file that was ALSO changed
// locally since the last successful sync. Detection is strictly file-level (no
// within-file merge). When a queued local batch conflicts, EVERYTHING from the
// first conflicting batch onward is stashed (§4 "full batches only"); batches
// before it apply cleanly. `firstConflictIndex` finds that pivot.

import { normpath } from '../mutation/posixPath.js';

// Files that are `prefix` itself or live under `prefix/` (so a directory op
// expands to every file beneath it — the recursive "directory op = every file
// under it" rule of §3). `paths` is the universe of known file paths.
function pathAndDescendants(prefix, paths) {
  const out = [];
  for (const p of paths) {
    if (p === prefix || p.startsWith(prefix + '/')) out.push(p);
  }
  return out;
}

// The concrete file paths a single op "changes" (§3 rename/delete semantics):
//   json_patch / unified_diff / create_file → the path itself.
//   delete_path                             → the path + its descendants (dir).
//   rename_path X→Y                         → X + descendants (source) AND the
//                                             mapped destinations + bare Y.
function opTouchedPaths(op, paths) {
  switch (op.op) {
    case 'json_patch':
    case 'unified_diff':
    case 'create_file':
      return [op.path];
    case 'delete_path':
      return pathAndDescendants(op.path, paths);
    case 'rename_path': {
      const from = op.from;
      const to = op.to;
      const sources = pathAndDescendants(from, paths);
      const touched = new Set(sources.length ? sources : [from]);
      // Each source maps to a destination; the bare `to` covers a file rename
      // and a collision where the remote independently created `to`.
      touched.add(to);
      for (const p of sources) {
        const rest = p === from ? '' : p.slice(from.length); // includes leading '/'
        touched.add(to + rest);
      }
      return [...touched];
    }
    default:
      return [];
  }
}

/**
 * The concrete, normalised file paths a batch touches.
 *
 * Directory ops are expanded against `paths` — pass the union of the base and
 * remote file paths. A file created purely by an earlier queued batch is not in
 * that universe, but it also cannot collide with a remote change (the remote has
 * never seen it), so the approximation is sound for conflict matching.
 *
 * @param {Array<object>} operations - raw op objects (`{op, path, …}`).
 * @param {Iterable<string>} paths - the known-paths universe (base ∪ remote).
 * @returns {Set<string>}
 */
export function batchTouchedPaths(operations, paths) {
  const known = paths instanceof Set ? paths : new Set(paths);
  const touched = new Set();
  for (const op of operations) {
    for (const p of opTouchedPaths(op, known)) touched.add(normpath(p));
  }
  return touched;
}

/**
 * Paths that differ between two content maps (added, removed, or modified).
 * Used to identify what the remote changed since our last-synced base.
 *
 * @param {Map<string,string>} baseMap - last-synced content.
 * @param {Map<string,string>} remoteMap - freshly-fetched remote content.
 * @returns {Set<string>}
 */
export function changedPaths(baseMap, remoteMap) {
  const changed = new Set();
  for (const [path, content] of remoteMap) {
    if (!baseMap.has(path) || baseMap.get(path) !== content) changed.add(path);
  }
  for (const path of baseMap.keys()) {
    if (!remoteMap.has(path)) changed.add(path);
  }
  return changed;
}

/**
 * The index of the first queued batch that touches a remotely-changed file, or
 * -1 if none conflict. Batches before this index rebase cleanly onto the remote;
 * this batch and every one after it are stashed whole (§4).
 *
 * @param {Array<{operations: Array<object>}>} queue
 * @param {Map<string,string>} baseMap
 * @param {Map<string,string>} remoteMap
 * @returns {number}
 */
export function firstConflictIndex(queue, baseMap, remoteMap) {
  const remoteChanged = changedPaths(baseMap, remoteMap);
  if (remoteChanged.size === 0) return -1;
  const universe = new Set([...baseMap.keys(), ...remoteMap.keys()]);
  for (let i = 0; i < queue.length; i++) {
    const touched = batchTouchedPaths(queue[i].operations, universe);
    for (const path of touched) {
      if (remoteChanged.has(path)) return i;
    }
  }
  return -1;
}
