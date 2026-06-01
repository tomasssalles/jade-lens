// Batch-level orchestration — port of jadelens/workflow.py, operating on an
// in-memory file map (Map<path, content>).
//
// The git-specific steps of the Python pipeline (require_clean_tree, git
// commit/revert) live in the per-client sync layer, not here: this is the pure,
// substrate-agnostic core the conformance suite validates. `run` works on a
// clone of the input map and returns a new map on success; on any failure it
// throws and the caller's input map is untouched (atomic batch).

import {
  ApplyError,
  BatchValidationError,
} from './errors.js';
import {
  CreateFile,
  DeletePath,
  RenamePath,
  JsonPatch,
  UnifiedDiff,
  parseOperation,
} from './operations.js';
import { findReferences, rewriteReferencesUnder } from './wikilinks.js';

// ---------- Batch validation ----------

export function validateBatch(operations) {
  // entries[path] = array of { index, category, summary }
  const entries = new Map();
  const add = (path, index, category, summary) => {
    if (!entries.has(path)) entries.set(path, []);
    entries.get(path).push({ index, category, summary });
  };

  operations.forEach((op, i) => {
    if (op instanceof JsonPatch) add(op.path, i, 'modify_json', 'json_patch');
    else if (op instanceof UnifiedDiff) add(op.path, i, 'modify_text', 'unified_diff');
    else if (op instanceof CreateFile) add(op.path, i, 'structure', 'create_file');
    else if (op instanceof DeletePath) add(op.path, i, 'structure', 'delete_path');
    else if (op instanceof RenamePath) {
      add(op.fromPath, i, 'structure', 'rename_path (from)');
      add(op.toPath, i, 'structure', 'rename_path (to)');
    } else {
      throw new BatchValidationError(`Unknown op type at index ${i}`, 'OP_UNKNOWN_TYPE');
    }
  });

  for (const [path, opsHere] of entries) {
    const categories = new Set(opsHere.map((e) => e.category));
    if (categories.size > 1) {
      const detail = opsHere.map((e) => `op ${e.index}: ${e.summary}`).join(', ');
      throw new BatchValidationError(
        `Path ${JSON.stringify(path)} is touched by incompatible op categories in one batch (${detail}). Split into separate batches.`,
        'BATCH_INCOMPATIBLE_CATEGORIES',
      );
    }
    if ([...categories][0] === 'structure' && opsHere.length > 1) {
      const detail = opsHere.map((e) => `op ${e.index}: ${e.summary}`).join(', ');
      throw new BatchValidationError(
        `Path ${JSON.stringify(path)} is touched by multiple structure ops in one batch (${detail}). ` +
          `Only one of create_file / delete_path / rename_path is allowed per path per batch.`,
        'BATCH_MULTIPLE_STRUCTURE_OPS',
      );
    }
  }
}

// ---------- Unified-diff merging ----------

function stripDiffPreamble(diffText) {
  const lines = diffText.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('@@')) i++;
  return lines.slice(i).join('\n');
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
          .map((d) => stripDiffPreamble(d.diff).replace(/\n+$/, ''))
          .join('\n') + '\n';
      merged.push(new UnifiedDiff(op.path, combined));
    } else {
      merged.push(op);
    }
  }
  return merged;
}

// ---------- Operations log ----------

function appendLogEntry(tree, rawOperations, commitMessage, timestamp) {
  const versionRaw = tree.get('.jade/version');
  const version = (versionRaw ?? '').trim();
  const logPath = `.jade/operations-log/${version}.jsonl`;
  const existing = tree.get(logPath) ?? '';
  const entry = {
    ts: timestamp,
    commit_message: commitMessage,
    operations: rawOperations,
  };
  tree.set(logPath, existing + JSON.stringify(entry) + '\n');
}

// ---------- Post-apply wikilink pass ----------

function postApplyWikilinkPass(tree, operations) {
  for (const op of operations) {
    if (op instanceof RenamePath) {
      rewriteReferencesUnder(tree, op.fromPath, op.toPath);
    }
  }
  for (const op of operations) {
    if (op instanceof DeletePath) {
      const refs = findReferences(tree, op.path);
      if (refs.length) {
        const detail = refs.map(([f, p]) => `${f}: [[${p}]]`).join('; ');
        throw new ApplyError(
          `delete_path: ${JSON.stringify(op.path)} is still referenced by wikilinks after the batch completed — ` +
            `clean these up in the same batch:\n  ${detail}`,
          'DELETE_DANGLING_WIKILINK',
        );
      }
    }
  }
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
  for (const op of effective) op.apply(work);
  postApplyWikilinkPass(work, effective);

  const timestamp = opts.timestamp ?? new Date().toISOString();
  appendLogEntry(work, rawOperations, commitMessage, timestamp);
  return work;
}
