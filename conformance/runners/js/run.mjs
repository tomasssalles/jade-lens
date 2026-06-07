#!/usr/bin/env node
// JS runner for the cross-client mutation conformance suite.
//
// Mirrors conformance/runners/python/test_conformance.py against the JS
// mutation pipeline (web/src/mutation). Each fixture in conformance/cases/*.json
// is fed through `run` over an in-memory file map; the outcome (resulting files,
// or rejection code) is compared to the fixture's expectation. See
// conformance/README.md for the contract.
//
// Run: `node conformance/runners/js/run.mjs` (exit 0 = all pass).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { run, ConformanceError } from "../../../web/src/mutation/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "..", "..", "cases");

// The data version the suite assumes unless a case seeds its own .jade/version
// (drives the operations-log filename — README §4).
const DEFAULT_DATA_VERSION = "v1";
const TS_SENTINEL = "<TS>";
const LOG_DIR_PREFIX = ".jade/operations-log/";

// ---------- normalisation (mirror the Python runner) ----------

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

function stableStringify(v) {
  return JSON.stringify(sortValue(v));
}

// Operations-log lines are compared structurally (parsed, ts blanked), not
// byte-wise — serialiser whitespace isn't part of the contract (README §4).
function normaliseContent(rel, content) {
  if (rel.startsWith(LOG_DIR_PREFIX)) {
    const lines = [];
    for (const line of content.split("\n")) {
      if (line.trim() === "") continue;
      const entry = JSON.parse(line);
      if ("ts" in entry) entry.ts = TS_SENTINEL;
      lines.push(stableStringify(entry));
    }
    return lines.join("\n");
  }
  return content;
}

function normaliseTree(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = normaliseContent(k, obj[k]);
  return out;
}

function treesEqual(actual, expected) {
  const a = normaliseTree(actual);
  const b = normaliseTree(expected);
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.join("\n") !== bk.join("\n")) {
    return {
      ok: false,
      msg: `file set differs:\n  actual:   ${JSON.stringify(ak)}\n  expected: ${JSON.stringify(bk)}`,
    };
  }
  for (const k of ak) {
    if (a[k] !== b[k]) {
      return {
        ok: false,
        msg: `content differs for ${k}:\n  actual:   ${JSON.stringify(a[k])}\n  expected: ${JSON.stringify(b[k])}`,
      };
    }
  }
  return { ok: true };
}

// ---------- run one case ----------

function runCase(c) {
  const before = c.before ?? {};
  const tree = new Map(Object.entries(before));
  const versionSeeded = !Object.hasOwn(before, ".jade/version");
  if (versionSeeded) tree.set(".jade/version", DEFAULT_DATA_VERSION + "\n");

  const expect = c.expect;
  const ops = c.operations;
  const message = c.commit_message ?? "";

  if (Object.hasOwn(expect, "error")) {
    let thrown = null;
    try {
      run(tree, ops, message);
    } catch (e) {
      thrown = e;
    }
    if (!thrown)
      return {
        ok: false,
        msg: `expected error ${expect.error} but the batch succeeded`,
      };
    if (!(thrown instanceof ConformanceError)) {
      return {
        ok: false,
        msg: `expected ConformanceError ${expect.error}, got ${thrown.stack ?? thrown}`,
      };
    }
    if (thrown.code !== expect.error) {
      return {
        ok: false,
        msg: `expected error code ${expect.error}, got ${thrown.code}`,
      };
    }
    // Atomicity: run() works on a clone, so the input `tree` is untouched by
    // construction — no partial application is possible.
    return { ok: true };
  }

  let out;
  try {
    out = run(tree, ops, message);
  } catch (e) {
    return {
      ok: false,
      msg: `unexpected failure: ${e.code ?? ""} ${e.stack ?? e}`,
    };
  }

  const actual = {};
  for (const [k, v] of out) {
    if (
      versionSeeded &&
      k === ".jade/version" &&
      !Object.hasOwn(expect.after, ".jade/version")
    ) {
      continue; // seeded precondition, not part of the contract
    }
    actual[k] = v;
  }
  return treesEqual(actual, expect.after);
}

// ---------- main ----------

const files = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

let passed = 0;
const failures = [];

for (const file of files) {
  const c = JSON.parse(readFileSync(join(CASES_DIR, file), "utf8"));
  let result;
  try {
    result = runCase(c);
  } catch (e) {
    result = { ok: false, msg: `runner threw: ${e.stack ?? e}` };
  }
  if (result.ok) {
    passed++;
  } else {
    failures.push({ file, msg: result.msg });
  }
}

for (const { file, msg } of failures) {
  console.error(`FAIL  ${file}\n      ${msg.replace(/\n/g, "\n      ")}\n`);
}

const total = files.length;
if (failures.length) {
  console.error(
    `\n${failures.length}/${total} conformance cases FAILED (${passed} passed).`,
  );
  process.exit(1);
} else {
  console.log(`All ${total} conformance cases passed (JS runner).`);
}
