# Mutation pipeline

Every change to the user's data — whether from the bot or from a manual UI edit —
goes through one pipeline that applies a small set of typed operations atomically,
records them, and commits. The pipeline is implemented **twice** (Python for the
CLI/skill, JavaScript for the web app) and the two are held **byte-identical** by
a conformance suite.

Source of truth:
- Python: `jadelens/operations.py` (the ops + parse/validate), `jadelens/workflow.py`
  (batch orchestration), `jadelens/wikilinks.py` (the post-apply reference pass).
- JavaScript: `web/src/mutation/`.
- Cross-client fixtures: `conformance/`.

Related design: `wikilinks.md`, `inline-sidecar-promotion.md` (a *planned*
pipeline step), `audit-and-correction.md`, `sync-and-conflicts.md`.

## The change format: five operations

The bot (and the UI) mutate data exclusively through a list of typed operations,
applied in order as **one atomic change**:

| Op | Use |
|---|---|
| `json_patch` | RFC 6902 patch against a JSON file. |
| `unified_diff` | Unified diff against an existing non-JSON (markdown) file; **0 context lines** by default to minimise output tokens. |
| `create_file` | Create a new JSON or markdown file with initial content. Missing parent dirs are auto-created (`mkdir -p`). |
| `delete_path` | Recursive delete of a file or directory. Refused if any wikilink still points under the target (see `wikilinks.md`). |
| `rename_path` | Rename a file or directory. Content preserved verbatim; wikilink references elsewhere are auto-rewritten by the runtime. |

There are no raw file-edit primitives — these five are the entire surface.

### Path-suffix rules (enforced at parse time)

- `json_patch`: target MUST end with `.json`.
- `unified_diff`: target must NOT end with `.json` (json_patch's territory);
  anything else is allowed.
- `create_file`: target must end with an *editable suffix* — currently `.json` or
  `.md`. Adding a new editable type is a one-line extension; `unified_diff`
  already covers any non-`.json` file.
- `rename_path` on a **file**: source and target suffix must match (no
  type-changing renames like `notes.md → notes.json`, which would mis-classify the
  content). Directory renames are exempt.

### Protected paths

Any top-level **dot-prefixed** path is reserved for tooling and rejected at parse
time (`.claude/`, `.git/`, `.gitignore`, `.jade/`, `.python-version`, …). This is
what keeps the bot out of the index-adjacent machinery, the operations log, and
the stash. (`Index.json` lives at the repo root precisely because it *is*
bot-managed — see `data-model.md`.)

### Content validation

- `create_file` with a `.json` path: the content MUST parse as valid JSON. Catches
  a latent corruption mode (a malformed file created fine, only failing later on a
  `json_patch` with no clean link back to the original mistake).

## Verification, atomicity, and ordering

The batch is applied as a single transaction (`workflow.run`):

1. **`validate_batch`** — structural validation of every op (exact required keys,
   no extras; suffix and protected-path rules; no path touched by incompatible op
   categories in one batch). Each failure carries a stable error `code`.
2. **`require_clean_tree`** — refuse if the data repo has uncommitted changes. This
   is what makes the revert-on-failure path safe: we never clobber the user's
   in-flight manual edits.
3. **Apply each op in order.** Multiple `unified_diff`s on the same file are merged
   first (`merge_unified_diffs`) so the bot can address every line number against
   the *pre-batch* file state. `unified_diff` apply verifies the claimed old lines
   match before applying; `json_patch` relies on RFC 6902 raising on missing paths
   / value mismatches.
4. **Post-apply wikilink pass** (`wikilinks.md`) — rename-rewrites and
   delete-reference checks run once, against the end-state.
5. **One log entry + one git commit** (`audit-and-correction.md`).

**Atomicity:** if any step fails, the whole batch is reverted (`git reset --hard
HEAD && git clean -fd`) and reported as a single failure — no partial application
ever lands. The repo is left exactly as it was, so the bot can simply retry with a
corrected batch.

## One pipeline, two clients, byte-identical

The web app and the `/jade` skill share the **data conventions** and the
**mutation pipeline**; only context-assembly differs (the web app builds prompts
deterministically; Claude Code explores agentically — see
`claude-code-integration.md`). Files end up structurally identical regardless of
which client made the change.

"Structurally identical" is sharpened to **byte-identical** by the conformance
suite (`conformance/`), which both pipelines must pass. The place this bites is
re-serialising a `.json` file after a `json_patch`: Python (`json.dumps`) and JS
(`JSON.stringify`) differ on float formatting (`1.0` vs `1`), non-ASCII escaping,
and empty-container edges. **The canonical form is the JS form**
(`JSON.stringify(obj, null, 2) + "\n"`) and Python matches it — not a style
choice but a necessity: a JS client loses integer-valued floats on `JSON.parse`
(`1.0` becomes `1` before it can re-serialise), so the only form both clients can
hold is JS's. In Python this is `operations.dumps_js_canonical` (`ensure_ascii=
False` + integer-valued-float→int); the same compact variant
(`dumps_js_canonical_compact`) serialises the operations-log line. See
`conformance/README.md`.

## The mutation tool (CLI)

On the `/jade` path the pipeline is invoked as `jadelens apply <data-repo>`, with
a single JSON object on stdin (heredoc avoids shell-escaping for multi-line
content):

```bash
jadelens apply /path/to/data-repo <<'EOF'
{
  "commit_message": "<one-line summary>",
  "operations": [
    { "op": "create_file",  "path": "...", "content": "..." },
    { "op": "delete_path",  "path": "..." },
    { "op": "rename_path",  "from": "...", "to": "..." },
    { "op": "json_patch",   "path": "...", "patch": [ <RFC 6902 op>, ... ] },
    { "op": "unified_diff", "path": "...", "diff": "..." }
  ]
}
EOF
```

All `path` / `from` / `to` values are relative to the data-repo root. The web app
passes the same operation shape to its in-browser pipeline instead of a CLI. The
CLI auto-syncs around the apply (pull before, push after — see
`sync-and-conflicts.md`).

> The bot writes a concise one-line `commit_message`; it does **not** repeat the
> user's verbatim prompt (real output tokens for marginal value — see
> `audit-and-correction.md`).

## Planned: inline-vs-sidecar promotion

A planned pipeline step (**not yet built** — see `inline-sidecar-promotion.md`)
will, when a `json_patch` writes a large or markdown-structured string value,
auto-migrate it to a `.md` sidecar and rewrite the value to a wikilink — so the
bot never has to decide. It will sit between validation and apply, and (like
everything else) must land in both pipelines and the conformance suite together.
