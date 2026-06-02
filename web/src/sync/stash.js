// Stash entry construction (Phase 2 of
// docs/mutation-sync-implementation-plan.md; design in docs/sync-and-conflicts.md
// §4). Pure logic — no network, no git, no IndexedDB.
//
// When a queued local batch conflicts with a remote change, the losing batch is
// stashed rather than lost: a self-contained JSON file under `.jade/stash/` that
// records the whole batch plus the *pristine ancestor* content of every file it
// touched. Stash entries are never auto-applied — they exist for the user to
// review and manually replay.
//
// Schema (a refinement of docs/sync-and-conflicts.md §4):
//   { timestamp, ancestors: {path: content}, operations: [<raw op>, ...] }
// `operations` holds the RAW op objects verbatim (the `{op, path, …}` wire
// format of DESIGN §4.2), not the illustrative `{type, path, payload}` shape the
// design doc originally sketched — the raw format is the conformance-pinned,
// cross-client-identical one, so web and /jade write byte-identical entries
// (Phase 6). The serialised file is JS-canonical (`JSON.stringify(.., 2) + "\n"`)
// for the same cross-client byte-identity reason.

import { batchTouchedPaths } from './conflicts.js';

const STASH_DIR = '.jade/stash';

/** ISO-8601 basic compact form for filenames: `20260601T143022Z`. */
export function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * The `.jade/stash/<compactISO>-<shortuuid>.json` path for an entry. Timestamp
 * first for chronological sort, short uuid for uniqueness within the instant.
 *
 * @param {string} timestamp - ISO timestamp (the entry's `timestamp` field).
 * @param {string} [uuid] - a uuid; defaults to a fresh `crypto.randomUUID()`.
 */
export function stashFilename(timestamp, uuid = crypto.randomUUID()) {
  const compact = compactTimestamp(new Date(timestamp));
  const short = uuid.replace(/-/g, '').slice(0, 8);
  return `${STASH_DIR}/${compact}-${short}.json`;
}

/**
 * Build the self-contained stash entry for one conflicting batch.
 *
 * `baseMap` MUST be the pristine, pre-local-change baseline (the last-synced base
 * the batch's ops were applied against) — NOT the remote version and NOT the
 * already-edited working content. Files the batch *creates* have no ancestor and
 * are omitted from `ancestors` (their absence is itself the "before" state).
 *
 * @param {{operations: Array<object>, timestamp: string}} batch
 * @param {Map<string,string>} baseMap - pristine ancestor source.
 * @returns {{timestamp: string, ancestors: Object<string,string>, operations: Array<object>}}
 */
export function buildStashEntry(batch, baseMap) {
  const touched = batchTouchedPaths(batch.operations, baseMap.keys());
  const ancestors = {};
  for (const path of [...touched].sort()) {
    if (baseMap.has(path)) ancestors[path] = baseMap.get(path);
  }
  return {
    timestamp: batch.timestamp,
    ancestors,
    operations: batch.operations,
  };
}

/** Serialise a stash entry to its on-disk form (JS-canonical, cross-client identical). */
export function serializeStashEntry(entry) {
  return JSON.stringify(entry, null, 2) + '\n';
}

/** Count the changed (+/-) lines in a unified diff, ignoring file headers. */
function countDiffLines(diff) {
  if (typeof diff !== 'string') return 0;
  let n = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) n += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) n += 1;
  }
  return n;
}

/**
 * A short human-readable description of a single operation, for the
 * stashed-changes view (docs/sync-and-conflicts.md §4 "Resolution").
 */
export function describeOperation(op) {
  switch (op.op) {
    case 'create_file':
      return `Created ${op.path}`;
    case 'delete_path':
      return `Deleted ${op.path}`;
    case 'rename_path':
      return `Renamed ${op.from} → ${op.to}`;
    case 'json_patch': {
      const n = Array.isArray(op.patch) ? op.patch.length : 0;
      return `Modified ${op.path} (${n} JSON change${n === 1 ? '' : 's'})`;
    }
    case 'unified_diff': {
      const n = countDiffLines(op.diff);
      return `Modified ${n} line${n === 1 ? '' : 's'} in ${op.path}`;
    }
    default:
      return `${op.op ?? 'unknown op'}${op.path ? ` ${op.path}` : ''}`;
  }
}

/** Whether a content map currently holds any stash entries (drives the indicator). */
export function hasStashEntries(contentMap) {
  for (const path of contentMap.keys()) {
    if (path.startsWith(STASH_DIR + '/') && path.endsWith('.json')) return true;
  }
  return false;
}

/** Every `.jade/stash/*.json` path in a content map, chronologically sorted. */
export function listStashPaths(contentMap) {
  const paths = [];
  for (const path of contentMap.keys()) {
    if (path.startsWith(STASH_DIR + '/') && path.endsWith('.json')) paths.push(path);
  }
  return paths.sort();
}

export { STASH_DIR };
