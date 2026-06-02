#!/usr/bin/env node
// JS runner for the cross-client STASH conformance scope.
//
// Mirrors conformance/runners/python/test_stash_conformance.py against the web
// pipeline (web/src/sync/stash.js). Each fixture in conformance/stash-cases/*.json
// carries the inputs (operations, timestamp, base_content) and the expected built
// `entry` + exact `serialized` bytes; a green pair (this + the Python runner)
// proves both clients write byte-identical stash entries.
//
// Run: `node conformance/runners/js/run-stash.mjs` (exit 0 = all pass).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildStashEntry, serializeStashEntry } from '../../../web/src/sync/stash.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, '..', '..', 'stash-cases');

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}
const stable = (v) => JSON.stringify(sortValue(v));

function runCase(c) {
  const baseMap = new Map(Object.entries(c.base_content ?? {}));
  const entry = buildStashEntry(
    { operations: c.operations, timestamp: c.timestamp },
    baseMap,
  );

  if (stable(entry) !== stable(c.expect.entry)) {
    return {
      ok: false,
      msg: `built entry differs:\n  actual:   ${stable(entry)}\n  expected: ${stable(c.expect.entry)}`,
    };
  }
  const serialized = serializeStashEntry(entry);
  if (serialized !== c.expect.serialized) {
    return {
      ok: false,
      msg: `serialized bytes differ:\n  actual:   ${JSON.stringify(serialized)}\n  expected: ${JSON.stringify(c.expect.serialized)}`,
    };
  }
  return { ok: true };
}

const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();

let passed = 0;
const failures = [];
for (const file of files) {
  let result;
  try {
    result = runCase(JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')));
  } catch (e) {
    result = { ok: false, msg: `runner threw: ${e.stack ?? e}` };
  }
  if (result.ok) passed++;
  else failures.push({ file, msg: result.msg });
}

for (const { file, msg } of failures) {
  console.error(`FAIL  ${file}\n      ${msg.replace(/\n/g, '\n      ')}\n`);
}

const total = files.length;
if (failures.length) {
  console.error(`\n${failures.length}/${total} stash conformance cases FAILED (${passed} passed).`);
  process.exit(1);
} else {
  console.log(`All ${total} stash conformance cases passed (JS runner).`);
}
