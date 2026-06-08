# JADE LENS — mutation conformance suite

A language-agnostic suite of test cases that pins the **behaviour of the
data-mutation pipeline**, so that every client which mutates a JADE LENS data
repo — the Python `jadelens-apply` tool today, the JavaScript web app
tomorrow — produces **byte-for-byte identical results** from the same inputs.

This directory holds the cases (declarative JSON fixtures) and the contract
they encode. Each client ships a thin *runner* that feeds the fixtures through
its own pipeline and asserts the outcome. The fixtures are the single source of
truth; the runners are small and language-local.

There are two scopes:

- **Mutation** (`cases/`) — op application: the pipeline behaviour. 62 cases.
- **Stash** (`stash-cases/`) — conflict-stash entry construction: given
  `operations` + `timestamp` + `base_content`, both clients must build the same
  `entry` and serialise the same exact bytes (so a stash created on one device
  reads identically on another). Runners: `runners/python/test_stash_conformance.py`
  and `runners/js/run-stash.mjs`. See §7.

---

## 1. Why this exists

DESIGN.md §12.1–§12.2 promises that the web app and the `/jade` skill share a
mutation pipeline: "files end up structurally identical regardless of which
client made the change." But the two clients cannot literally share code — one
is Python operating on a local git clone, the other is JavaScript operating on
the GitHub API from a browser. The pipeline will be **implemented twice**.

Two implementations of the same contract drift unless something holds them
together. Rather than extract a shared cross-language package (heavy: a Rust
core with bindings, or codegen, plus a build-time coupling across two repos),
we pin the *behaviour* with a shared conformance suite. This is the same
pattern CommonMark uses to keep dozens of independent Markdown implementations
in agreement: one file of `input → expected output`, run by everyone.

Once the behaviour is pinned by a suite both sides must pass, **code
duplication stops being a correctness risk.** The Python and JS pipelines can
look nothing alike internally, as long as they agree on every fixture.

### What it buys us, in order of when it pays off

1. **Now: an executable spec + regression net for the Python pipeline.** The
   behaviour currently lives in Python-specific pytest assertions (and partly
   only implicitly). Capturing it declaratively makes it readable, reviewable,
   and reusable.
2. **Later: the build-to target for the JS pipeline.** When the web app gains
   write capability, you build it until the shared suite goes green — instead
   of reverse-engineering Python behaviour into JS and hoping. This is what
   de-risks UI mutation from "a second implementation you pray matches" into
   "an implementation with an executable acceptance test."
3. **Ongoing: drift protection.** Change one side's behaviour and its runner
   fails until the fixture is updated; then the other side's runner fails until
   it's brought into line. Divergence becomes a loud test failure, not a silent
   bug.

---

## 2. The contract: what is and isn't pinned

The mutation pipeline is two layers. Only the **portable** layer is in scope.

### In scope — the portable transform

Given a set of files and a batch of operations, the suite pins the resulting
set of files, or the rejection:

- **Operation parsing & structural validation** — required/unknown/wrong-typed
  fields, unknown op types, exact-keys enforcement (§4.2).
- **Path-suffix rules** — `json_patch` only on `.json`; `unified_diff` never on
  `.json`; `create_file` only on editable suffixes (`.json`, `.md`);
  `rename_path` preserves a file's suffix (§4.2).
- **Protected-path rejection** — any op targeting a top-level dot-prefixed path
  (`.jade/`, `.claude/`, `.git/`, `.gitignore`, …) is refused (§4.2, changelog).
- **Batch validation** — a path touched by incompatible op categories in one
  batch, or by multiple structure ops, is refused (`validate_batch`).
- **Unified-diff merging** — multiple `unified_diff` ops on one path merge into
  a single diff against the pre-batch file state (`merge_unified_diffs`).
- **Operation application → resulting files** — JSON Patch (RFC 6902) results,
  unified-diff results (incl. the line-content verification), `create_file`,
  `delete_path`, `rename_path`.
- **Wikilink post-pass** — on `rename_path`, every `[[old]]` wikilink in
  git-visible files is rewritten to `[[new]]`; on `delete_path`, a surviving
  `[[deleted]]` reference fails the batch (§4.3).
- **The operations-log entry** — schema `{ts, commit_message, operations}`, one
  entry per atomic batch, appended to `.jade/operations-log/<version>.jsonl`,
  with `operations` holding the raw ops as emitted (§7.1, §7.2, §9.2). The log
  file is just another file in the repo, so it falls out of the same before →
  after file comparison — **with the timestamp normalised** (see §4).
- **Atomicity** — on any failure, *no* file changes land (all-or-nothing).

### Out of scope — client-specific substrate

These differ by design (DESIGN §12.1) and are **not** compared:

- **The write mechanism** — `git add`/`commit` (Python) vs. a GitHub API file
  write (JS). The suite checks the resulting *files*, not how they were written.
- **The commit SHA** — recovered from git in one world, returned by the API in
  the other.
- **The timestamp *value*** (`ts`) — wall-clock, nondeterministic. The log
  entry's *schema and presence* are in scope; the value is normalised away.
- **The clean-tree precondition and revert-on-failure** — these are git-working-
  tree concerns specific to the local-clone client. (Atomicity *as observable
  in the resulting files* is in scope; the git mechanism that achieves it is
  not.)

---

## 3. Fixture format

Each case is one JSON file under `cases/`. Schema:

```json
{
  "name": "human-readable case name",
  "description": "optional — why this case exists / what rule it pins",
  "before": {
    "<repo-relative path>": "<file content as a string>",
    "...": "..."
  },
  "commit_message": "message the client would attach to this batch",
  "operations": [
    { "op": "...", "...": "..." }
  ],
  "expect": {
    "after": {
      "<repo-relative path>": "<expected file content>",
      "...": "..."
    }
  }
}
```

For a case that must be **rejected**, replace `after` with an `error` code:

```json
{
  "name": "json_patch rejected on a markdown file",
  "before": { "notes.md": "# Notes\n" },
  "operations": [
    { "op": "json_patch", "path": "notes.md", "patch": [] }
  ],
  "expect": { "error": "JSON_PATCH_WRONG_SUFFIX" }
}
```

### Conventions

- **Paths** are POSIX, relative to the data-repo root.
- **`before`** is the complete set of repo files the case cares about. Runners
  start from an empty repo and write exactly these. The error/success outcome
  must not depend on files outside `before`.
- **`after`** (success cases) is the **complete expected file set** — every file
  present afterwards, including ones carried over unchanged and the appended
  operations-log line. A file present in `before` but absent from `after` is
  asserted to have been deleted. (See §4 for the log-file and `.jade/version`
  handling.)
- **`error`** (rejection cases) is a stable code from §5. On rejection, the
  runner must also assert **atomicity**: the repo is byte-for-byte equal to
  `before` (no partial application).
- **Exactly one** of `after` / `error` is present.
- Content strings are verbatim, including trailing newlines. JSON Patch results
  are serialised by the pipeline in the **canonical JS form** —
  `JSON.stringify(obj, null, 2) + "\n"` (Python: `dumps_js_canonical`, see §4) —
  and the fixtures encode that exact form. `apply_json_canonical_serialisation`
  pins the two characteristic properties: integer-valued floats print without
  `.0`, and non-ASCII is emitted raw.

---

## 4. What a runner must do

A runner is a thin adapter — pseudocode:

```
for each case in cases/:
    repo = fresh empty data repo
    seed repo with the version file (.jade/version) and any git init the
        client needs        # see "Fixture preconditions" below
    write every file in case.before
    snapshot = repo state

    result = run_pipeline(repo, case.operations, case.commit_message)

    if case.expect.after:
        assert pipeline succeeded
        actual = read all files in repo, with normalisation (below)
        assert actual == case.expect.after
    else:  # case.expect.error
        assert pipeline raised, with code == case.expect.error
        assert repo state == snapshot      # atomicity
```

### Normalisation (applied before comparing files)

- **Operations-log lines are compared structurally, not byte-wise.** Each line
  of a `.jade/operations-log/*.jsonl` file is parsed as JSON; the `ts` value is
  replaced with the sentinel `"<TS>"`; the resulting object is deep-compared to
  the parsed fixture line. This is deliberate: the log is serialised by the
  client (`json.dumps` in Python, `JSON.stringify` in JS), and those serialisers
  differ in whitespace and non-ASCII escaping — differences that are *not* part
  of the contract. The contract is the log entry's **structure**
  (`{ts, commit_message, operations}` with the raw ops), not its byte layout.
  Fixtures store log lines in canonical Python `json.dumps` form with
  `"ts": "<TS>"`; runners parse rather than string-match them.
- **All other files are compared byte-for-byte**, after the timestamp handling
  above. Content is verbatim, trailing newlines included.

### Canonical JSON serialisation is JS-style (implemented)

When `json_patch` modifies a `.json` data file, the pipeline re-serialises the
whole file. The canonical form both clients must emit is the **JS form** —
`JSON.stringify(obj, null, 2) + "\n"` — and the contract is **byte-identical**
across clients. Python matches it (rather than the reverse) because JS is
representationally weaker: a JS client loses integer-valued floats on
`JSON.parse` (`1.0` is already the Number `1` before it re-serialises), so a
byte-canonical contract can only be agreed on JS's terms.

Python's `jadelens.operations.dumps_js_canonical` produces this form. Two deltas
from a bare `json.dumps(indent=2)`: `ensure_ascii=False` (raw UTF-8, not
`\uXXXX`) and integer-valued floats normalised to ints (`1.0` → `1`, via a
pre-walk, since the C float encoder can't be intercepted by a custom
`JSONEncoder`). Item/key separators already match JS at `indent=2`. **Known
residual edge:** integer-valued floats with `abs(x) >= 1e21` stay floats,
because JS prints them in exponent form (`"1e+21"`) rather than as plain digits;
such magnitudes don't occur in this domain (tracked in
`docs/planning/known_issues.md`). Non-finite floats (`NaN`/`Infinity`) are not
specially handled yet.

Cases that only modify JSON *textually* (e.g. the wikilink rewriter's in-place
regex replace, which preserves formatting) are unaffected by this — they compare
byte-for-byte regardless.

### Fixture preconditions (runner responsibility, not in the fixture)

- The operations-log path depends on `.jade/version`. Runners seed a known
  version (the suite assumes **`v1`** unless a case's `before` provides its
  own `.jade/version`). Since `.jade/` is a protected path the bot can't write,
  it's a precondition, not an operation.
- The Python client requires a git repo (for `git mv`/`rm` and commit). The
  Python runner does `git init` + an initial commit of `before`. The JS client
  has no such need. **This difference is exactly why git plumbing is out of
  the contract** — the runner sets up whatever its client needs, and only the
  resulting *files* are compared.

---

## 5. Error codes

Rejection cases assert a **stable code**, not a prose message (messages are
language-specific and may be reworded; codes are the contract). Each code maps
to one raise-site class of the pipeline. The canonical list lives here; both
clients map their internal errors onto these.

| Code | Meaning |
|---|---|
| `OP_NOT_OBJECT` | An operation is not a JSON object. |
| `OP_MISSING_OP_FIELD` | An operation has no `op` field. |
| `OP_UNKNOWN_TYPE` | `op` is not one of the five known types. |
| `OP_MISSING_KEYS` | A required key for the op is absent. |
| `OP_UNEXPECTED_KEYS` | An op carries keys beyond its allowed set. |
| `OP_WRONG_FIELD_TYPE` | A field has the wrong JSON type (e.g. `path` not a string, `patch` not a list). |
| `PROTECTED_PATH` | An op targets a top-level dot-prefixed path. |
| `CREATE_FILE_BAD_SUFFIX` | `create_file` path not in the editable-suffix set. |
| `CREATE_FILE_INVALID_JSON` | `create_file` `.json` content doesn't parse. |
| `JSON_PATCH_WRONG_SUFFIX` | `json_patch` target doesn't end in `.json`. |
| `UNIFIED_DIFF_WRONG_SUFFIX` | `unified_diff` target ends in `.json`. |
| `RENAME_SUFFIX_CHANGED` | `rename_path` on a file changes the suffix. |
| `BATCH_INCOMPATIBLE_CATEGORIES` | A path is touched by mixed op categories in one batch. |
| `BATCH_MULTIPLE_STRUCTURE_OPS` | A path is touched by >1 structure op in one batch. |
| `TARGET_NOT_FOUND` | An op's target file/path doesn't exist (apply-time). |
| `TARGET_EXISTS` | `create_file`/`rename_path` target already exists. |
| `TARGET_NOT_A_FILE` | A file op targets a directory. |
| `JSON_PATCH_TARGET_INVALID_JSON` | `json_patch` target file isn't valid JSON. |
| `JSON_PATCH_APPLY_FAILED` | RFC 6902 application failed (missing path, failed `test`, etc.). |
| `UNIFIED_DIFF_PARSE_FAILED` | The diff text couldn't be parsed. |
| `UNIFIED_DIFF_APPLY_FAILED` | A `-` line didn't match the file at the claimed position. |
| `DELETE_DANGLING_WIKILINK` | After the batch, a `[[wikilink]]` still points at a deleted path. |

Notes:

- Codes describe the *first* failure the pipeline reports. Cases are written so
  the asserted failure is unambiguous (one rule violated per rejection case).
- This table is versioned with the suite. Adding a rule means adding a code
  here, a fixture, and the mapping in each runner.
- The Python pipeline currently raises with prose only. Assigning these codes
  to its raise-sites (an `code` attribute on the exception classes) is a small
  prerequisite refactor, tracked alongside the first runner.

---

## 6. Layout

```
conformance/
├── README.md          # this file — the contract
├── cases/             # *.json mutation fixtures, one case per file
├── stash-cases/       # *.json stash-entry fixtures (the stash scope, §9)
└── runners/
    ├── python/       # test_conformance.py (mutation) + test_stash_conformance.py
    └── js/           # run.mjs (mutation) + run-stash.mjs (stash)
```

Cases are grouped by filename prefix for readability, not by any loaded
manifest — runners glob `cases/*.json`. Suggested prefixes: `parse_`,
`suffix_`, `protected_`, `batch_`, `apply_json_`, `apply_diff_`, `create_`,
`delete_`, `rename_`, `wikilink_`, `log_`, `atomic_`.

---

## 7. Adding a case

1. Write `cases/<prefix>_<name>.json` per §3.
2. If it's a rejection case asserting a new failure mode, add the code to §5.
3. Run every client's runner. All must pass (or, for a deliberate behaviour
   change, all must be updated together — that's the point).

A case should pin **one** behaviour. Prefer many small focused cases over few
broad ones: when a runner fails, the case name should tell you what broke.

---

## 9. The stash scope (`stash-cases/`)

The conflict stash (docs/sync-and-conflicts.md §4) is the other cross-client
artifact: a stash created by one client must be read identically by another. The
stash scope pins **stash-entry construction** the same way the mutation scope
pins op application.

**Fixture shape:**

```json
{
  "name": "...",
  "description": "...",
  "timestamp": "2026-06-01T14:30:22.123Z",
  "base_content": { "<path>": "<pristine content>", ... },
  "operations": [ { "op": "...", ... } ],
  "expect": {
    "entry": { "timestamp": "...", "ancestors": { ... }, "operations": [ ... ] },
    "serialized": "<exact JS-canonical bytes: JSON.stringify(entry, null, 2) + \"\\n\">"
  }
}
```

A runner builds the entry from `operations` + `timestamp` + `base_content` (its
own `build_stash_entry` / `buildStashEntry`) and asserts it equals `expect.entry`
**and** that serialising it yields `expect.serialized` byte-for-byte. `ancestors`
are the pristine pre-change content of every touched file present at the base
(created files omitted), keys sorted; `operations` are verbatim. The byte
contract is the same JS-canonical form as re-serialised `.json` data files
(ensure_ascii=False, integer-valued floats normalised) — see §3–§4.

Runners: `runners/python/test_stash_conformance.py` (in `uv run pytest`) and
`runners/js/run-stash.mjs` (in `npm test` after the mutation runner).

---

## 8. Scope boundaries (what this suite is *not*)

- **Not** a test of git, the GitHub API, sync, or conflict resolution.
- **Not** a test of skill rendering, the CLI onboarding flow, or reflection
  formatting — those are client-tooling concerns, single-language, and stay in
  their own native test suites (e.g. Python's `tests/test_cli.py`,
  `test_render.py`, `test_reflection.py`).
- **Not** a test of the bot's behaviour or prompt content.
- **Not** a performance benchmark.

The native pytest suite remains the place for Python-internal details (git
plumbing, subprocess error handling, reflection text). The conformance suite
covers only the cross-client behavioural contract — the overlap is intentional:
the same behaviour is asserted natively *and* portably, and that's fine.
```
