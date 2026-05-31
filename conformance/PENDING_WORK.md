# Conformance suite — pending work

> **Status (updated 2026-05-31): Part A and Part B Tiers 1–3 are DONE.**
> The conformance suite is at **62 cases** (from 29). What's implemented:
> - **Part A** — `operations.dumps_js_canonical` (ensure_ascii=False +
>   integer-valued-float→int) at the json_patch re-serialisation site, with unit
>   tests (`tests/test_json_canonical.py`) and the
>   `apply_json_canonical_serialisation` conformance case. README §3–§4 and
>   DESIGN §12.2 flipped to "implemented"; changelog noted.
> - **Part B** — all Tier 1 (json_patch happy path + 4 missing error codes),
>   Tier 2 (directory ops, partial-batch atomicity, mixed batch, log-append,
>   cross-client wikilink behaviours), and Tier 3 (variant cases) fixtures added.
>   Two planned cases were skipped as already-covered (noted in their tier).
>
> **What remains (deliberately deferred):** the JS pipeline doesn't exist yet,
> so the JS *runner* (`conformance/runners/js/`) is still future work — the
> suite currently has one runner (Python). The serialisation edge cases in §A.4
> below (large integer-valued floats ≥1e21, non-finite floats) are documented
> but not specially handled; no fixture needs them in this domain.
>
> The rest of this doc is retained as the **edge-case reference** (cited from
> `conformance/README.md` §4) and the record of what was audited.

---

> **Original work order (captured before implementation).** Two independent
> bodies of work: **Part A** — make Python's JSON serialisation JS-faithful and
> byte-canonical. **Part B** — close the conformance test-case gaps found by
> auditing the pre-existing Python tests against the §2 scope of
> `conformance/README.md`.

---

## Part A — JS-faithful, byte-canonical JSON serialisation

### A.0 The decision (recap)

The mutation pipeline is implemented twice (Python `jadelens-apply`, future JS
web app) and the conformance suite requires **byte-identical** output from both.
The one place this bites is re-serialising a `.json` data file after a
`json_patch`. **Decision: the canonical form is the JS form**
(`JSON.stringify(obj, null, 2) + "\n"`), and **Python changes to match.**

This is not a style preference. JS is representationally weaker: the moment a JS
client does `JSON.parse`, an integer-valued float `1.0` is already the Number
`1` in memory and will re-serialise as `1`. JS *cannot* hold the Python-only
form, so a byte-canonical contract can only be agreed on JS's terms. Floats are
realistic once the repo stores coding-project metadata (versions, coverage,
benchmark timings), so this matters in practice.

### A.1 The only site in the byte-contract

Serialisation sites in the Python source (verified):

| Site | What it does | In byte-contract? |
|---|---|---|
| `operations.py:159` — `JsonPatch.apply` | `json.dumps(result, indent=2) + "\n"` re-serialises the whole `.json` data file after applying the patch | **YES — the one site to fix** |
| `operations.py:69` — `CreateFile.apply` | `write_text(self.content)` — writes the bot's literal string verbatim | No — content is byte-preserved, never re-serialised |
| `operations.py:143` / `:244` — `json.loads` | reads the target / validates `create_file` content | Read-only; see A.3 |
| `workflow.py:262` — `append_log_entry` | `json.dumps(entry) + "\n"` for the operations-log line | No — the log is compared **structurally** (parsed, `ts` normalised) per README §4, so its byte layout is explicitly out of the contract. Leave as-is. |

So **only `operations.py:159` changes** for the byte-contract. (Optionally align
the log serialiser too for tidiness, but it is not required and not tested.)

### A.2 The concrete deltas (Python `json.dumps(indent=2)` vs JS `JSON.stringify(obj,null,2)`)

Most things already agree at `indent=2`: item separator `,`, key separator
`: `, key order (both preserve insertion order, neither sorts), empty containers
(`{}` / `[]` identical), forward slashes unescaped, U+2028/U+2029 unescaped.
The real differences:

1. **Non-ASCII escaping.** Python defaults to `ensure_ascii=True` → emits
   `\uXXXX`. JS emits the raw UTF-8 character. **Fix:** `ensure_ascii=False`.

2. **Integer-valued floats.** Python writes `1.0` → `"1.0"`; JS writes `1.0`
   → `"1"` (the `.0` is already gone after parse). **Fix:** before dumping,
   walk the object and convert any `float` that `is_integer()` to `int`
   (within the safe range — see A.4). Genuine non-integer floats (`1.5`,
   `0.1`) are written the same by both and stay as-is.

### A.3 Implementation sketch

Pre-walk the parsed result normalising floats, then dump JS-style. A custom
`json.JSONEncoder` does **not** suffice — float formatting is done by the C
encoder via `float.__repr__`, so the conversion must happen on the object
before `dumps`.

```python
import math

def _js_canonical(obj):
    # bool is a subclass of int — must be checked first and left alone.
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        # JS loses integer-valued floats on parse: 1.0 -> 1.
        if math.isfinite(obj) and obj.is_integer() and _js_prints_as_integer(obj):
            return int(obj)
        return obj  # genuine fraction, or a magnitude JS prints in exponent form
    if isinstance(obj, dict):
        return {k: _js_canonical(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_js_canonical(v) for v in obj]
    return obj

# at operations.py:159, replacing the current dumps:
canonical = _js_canonical(result)
target.write_text(json.dumps(canonical, ensure_ascii=False, indent=2) + "\n")
```

`json.loads` at `:143` already produces floats for `1.0`; the pre-walk converts
them, so reading then writing an untouched-but-integer-valued float in the file
will *also* rewrite `1.0` → `1`. That is intended and matches what a JS client
would do to the same file — but note it means a `json_patch` touching one field
can canonicalise integer-valued floats **elsewhere** in the file. Call this out
in the changelog when it lands.

### A.4 Edge cases to decide / handle

- **Large integer-valued floats.** `1e21` is `is_integer()` True, but
  `JSON.stringify(1e21)` → `"1e+21"`, whereas `int(1e21)` would dump as
  `"1000000000000000000000000000000"`. JS switches to exponent notation at
  ≥ `1e21` (and ≤ `1e-7` for small fractions). The `_js_prints_as_integer`
  guard above must only convert to `int` when JS would also print plain digits
  (roughly `abs(x) < 1e21`); otherwise replicate JS's `Number.prototype
  .toString` (shortest round-trip + exponent thresholds). **In our domain these
  magnitudes won't occur**, but the contract should specify the rule rather than
  silently diverge. Recommendation: implement the `< 1e21` guard now; document
  the exponent-form replication as a known residual until a fixture needs it.
- **Non-finite floats.** `NaN`/`Infinity` — Python `json.dumps` emits the
  invalid tokens `NaN`/`Infinity` by default; `JSON.stringify` emits `null`.
  Decide: reject at validation time, or coerce to `null`. They shouldn't appear
  in life-admin/coding data; simplest is to keep `allow_nan` default and add a
  fixture only if it ever matters. Note in the contract.
- **`-0.0`.** Integer-valued (`-0.0 == 0`), so the int-conversion turns it into
  `0` → `"0"`, which matches `JSON.stringify(-0)` → `"0"`. No special handling
  needed; just don't special-case it back into a float.
- **Generic float repr divergence.** Both Python and modern JS use
  shortest-round-trip float formatting, so `0.1`, `3.14`, etc. agree. Edge
  exponent boundaries are the only residual risk (see large-floats above).

### A.5 When it lands

1. Apply the A.3 change at `operations.py:159`.
2. Add a `tests/` unit test for `_js_canonical` (ensure_ascii off, `1.0`→`1`,
   `1.5` preserved, bool untouched, nested, large-float guard).
3. **Update the affected conformance fixtures in the same commit** — any
   success case whose `after` contains a pipeline-re-serialised `.json` file
   moves from the current Python form to the JS form. (After Part B lands, that
   is at minimum the new `apply_json_*` happy-path fixtures — see B, Tier 1.)
4. Flip `conformance/README.md` §4 from "Decided (not yet implemented)" to
   implemented, and update the §3 note. Update `DESIGN.md` §12.2.
5. Note in the changelog that integer-valued floats are canonicalised to ints
   on any `json_patch` write, file-wide.

---

## Part B — conformance test-case gaps

Audit method: mapped the six conformance-scope test files
(`test_operations_parse`, `test_operations_apply`, `test_json_patch_apply`,
`test_unified_diff`, `test_workflow`, `test_wikilinks`) against README §2 scope
and the 29 existing fixtures. Excluded as out-of-scope per §2: git plumbing
(`require_clean_tree`, `revert`, `git_commit`, "stages deletion in git", SHA
assertions, dirty-tree refusal) and the low-level `parse_unified_diff`→`Hunk`
representation tests (internal; the contract is diff-in → file-out / error code,
not the Hunk shape).

All four "uncovered error codes" are **wired in the source** (verified:
`operations.py` lines 209, 139/177, 147, 186), so fixtures will pass against the
Python runner as-is.

### Tier 1 — hard gaps: tested behaviour, in scope, no fixture AND no coverage

| Proposed fixture | Rule / behaviour | Outcome | Source test |
|---|---|---|---|
| `apply_json_add_and_format.json` (+ a couple more RFC-6902 ops) | **`json_patch` happy path + the pretty-printed, trailing-newline output format.** The single most important gap — no `apply_json_*` success fixture exists, so the entire JSON re-serialisation contract (all of Part A) is unpinned. | `after` = re-serialised `.json` (encode in the **JS form** if Part A lands first; otherwise current Python form, flagged for update) | `test_json_patch_apply.py` happy paths + `test_output_is_pretty_printed_with_trailing_newline` |
| `parse_op_not_object.json` | An operation is not a JSON object | `error: OP_NOT_OBJECT` | `test_non_dict_raises` |
| `json_patch_target_not_a_file.json` | `json_patch` targets a directory | `error: TARGET_NOT_A_FILE` | `test_rejects_directory_target` |
| `unified_diff_target_not_a_file.json` | `unified_diff` targets a directory | `error: TARGET_NOT_A_FILE` | `test_unified_diff_op_rejects_directory_target` |
| `json_patch_target_invalid_json.json` | `json_patch` target file isn't valid JSON | `error: JSON_PATCH_TARGET_INVALID_JSON` | `test_rejects_non_json_target` |
| `unified_diff_parse_failed.json` | diff text unparseable (distinct from `_APPLY_FAILED`, which *is* covered) | `error: UNIFIED_DIFF_PARSE_FAILED` | `test_unified_diff_op_wraps_parse_error` + parser-reject tests |

### Tier 2 — in-scope behaviours with no fixture (code may be pinned elsewhere; the behaviour isn't)

| Proposed fixture | Behaviour | Source test |
|---|---|---|
| `delete_directory_recursive.json` | `delete_path` removes a directory and all contents | `test_delete_path_recursive_directory` |
| `rename_directory.json` | `rename_path` moves a directory tree | `test_rename_path_directory` |
| `rename_directory_suffix_ignored.json` | suffix-preservation rule does **not** apply to directories | `test_rename_path_directory_suffixes_dont_matter` |
| `create_file_makes_parents.json` | `create_file` creates missing parent directories | `test_create_file_creates_missing_parents` |
| `atomic_partial_batch_reverts.json` | multi-op batch where op1 succeeds, op2 fails → op1 rolled back (stronger than single-op rejection) | `test_run_aborts_and_reverts_on_apply_failure` |
| `apply_mixed_batch.json` | end-to-end create + json_patch + rename in one batch | `test_run_happy_path_mixed_ops` |
| `log_append_to_existing.json` | `before` has a log file with one entry; `after` has two | `test_append_log_entry_appends_to_existing` |
| `wikilink_rewrite_in_json.json` | rename rewrites a `[[..]]` embedded in a `.json` file | `test_rewrites_references_in_json` |
| `wikilink_rename_directory_nested.json` | directory rename swaps prefix in deeply-nested refs | `test_directory_rename_rewrites_deeply_nested_refs` |
| `wikilink_denormalised_rewritten_clean.json` | matching denormalised link (`[[bar/../old.md]]`) → clean output | `test_rewrites_denormalised_input_to_clean_output` |
| `wikilink_unrelated_preserved_byte_identical.json` | non-matching links returned **byte-identical** even if denormalised (DESIGN §4.3 — core byte-level contract) | `test_preserves_unrelated_wikilinks_byte_identical` |
| `wikilink_skips_gitignored.json` | gitignored files never scanned/rewritten | `test_skips_gitignored_files` / `test_doesnt_touch_gitignored_files` (needs `.gitignore` in `before`) |
| `wikilink_rename_self_reference.json` | a file's link to itself is rewritten on its own rename | `test_rename_rewrites_self_reference` |
| `wikilink_rename_explicit_diff_override.json` | explicit `unified_diff` on a ref wins over the auto-rewrite (post-pass sees only end state) | `test_rename_then_explicit_diff_clobbers_auto_rewrite` |

### Tier 3 — same-code variants (low priority; code already pinned, variant exercises a different op/path)

- Protected-path on `delete` / `rename` (from **and** to) / `json_patch` /
  `unified_diff` — only `create_file` has a `PROTECTED_PATH` fixture.
  (`test_delete_path_rejects_protected_path`, `..._rejects_protected_from/_to`,
  `test_json_patch_rejects_protected_path`, `test_unified_diff_rejects_protected_path`)
- `OP_MISSING_KEYS` on `rename_path` (missing `to`) — current fixture is
  `create_file` missing `content`. (`test_rename_path_missing_to_raises`)
- Bare-dict-instead-of-list patch — same `OP_WRONG_FIELD_TYPE` code but
  DESIGN §12.2 calls this realistic bot mistake out by name.
  (`test_json_patch_with_bare_patch_dict_instead_of_list_raises`)
- Incompatible-category variants: `delete`+`json_patch`, `create`+`unified_diff`,
  `unified_diff` on a renamed from/to path. (several `test_validate_batch_*`)
- Two renames whose `to` paths collide → `BATCH_MULTIPLE_STRUCTURE_OPS`.
  (`test_validate_batch_rejects_two_renames_sharing_a_path`)
- Diff hunk references past EOF → `UNIFIED_DIFF_APPLY_FAILED` variant.
  (`test_apply_raises_when_hunk_references_past_eof`)
- Leading `./` stripped and allowed; `create_file` accepts `.md`; delete of a
  directory containing internal self-refs succeeds (refs inside the deleted dir
  don't count). (`test_protected_check_allows_leading_dot_slash`,
  `test_create_file_accepts_md`, `test_delete_doesnt_count_references_from_inside_deleted_dir`)

### Notes for whoever implements Part B

- Each fixture follows `conformance/README.md` §3. Rejection cases assert a
  `error` code and the runner also asserts atomicity (repo == `before`).
- Fixtures needing a `.gitignore` or a pre-existing log put them in `before`;
  the Python runner `git init`s and commits `before` (README §4 preconditions).
- Group by filename prefix (README §6): `parse_`, `suffix_`, `protected_`,
  `batch_`, `apply_json_`, `apply_diff_`, `create_`, `delete_`, `rename_`,
  `wikilink_`, `log_`, `atomic_`.
- After adding any rejection case for a **new** code, it's already in the §5
  table — no table edit needed for the four Tier-1 codes.
- Run `uv run pytest conformance -q` (the Python runner globs `cases/*.json`).
