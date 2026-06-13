# Sidecar promotion — implementation plan

Working plan for the sidecar promotion feature and the surrounding
infrastructure it requires. Each task is self-contained (implement → test →
commit → push to `claude-ai`). Conformance suite cases belong alongside every
pipeline task and are not listed separately. Changelogs (`docs/changelogs/*/
unreleased.md`) are updated incrementally as tasks complete.

Design reference: `docs/design/inline-sidecar-promotion.md`,
`docs/planning/sidecar-promotion-decisions.md`.

---

## Items to be documented as future work:

- [ ] Optimization: Enforce sidecar integrity only on afected JSONs
- [ ] Optimization: We now have multiple wikilink passes over the entire repo. If 2 files are moved and 1 file deleted, we search for all wikilinks 4 times: 2 times to edit them because of the moves, 1 time to check for dangling references because of the deletion, and 1 time to make sure that wikilinks always point to existing files (4e). First of all, the wikilink integrity check already covers the deletion case, so we can drop that check. That's 3 passes instead of 4. But we could even do a single pass, collecting infos such as `{"[[<wikilink-path>]]": [<occurrences>]}` where an occurrence is of the form `{"file": "<occurrence-filepath>", [<occurrences-within-file>]}` and an occurrence within a file is either a line number (in case of markdown) or a JSON-pointer (in case of JSON). With this information we could efficiently edit the wikilinks to files that were moved and check the integrity of all the other wikilinks. This might not be perfect though. For example, if a line in a markdown file contains 2 wikilinks to files that were moved, we need to be careful (in particular, we should not store the current JSON values and current markdown lines in the collect info about wikilinks, but only the information about where they are). Just noticed: This collected info can also be used to validate that sidecar wikilinks only occur exactly once, at the JSON path whose value they represent (5f-iv).
- [ ] Sidecars: inline accordion expansion of the truncated-text card in the card view.

---

## Phase 1 — Groundwork

- [x] **1a.** Read the versioning design doc to confirm the mechanics for
  seeding the v2 data-format requirement in both codebases before implementing
  anything that depends on it.

---

## Phase 2 — Index-driven file tree (web)

- [x] **2a.** Replace the file tree with an index-driven list built from
  `Index.json`. Excludes `Index.json` itself naturally. Should also remove the special handling built into the code for displaying the Index at the top of the file tree. Files not in the index are not
  shown.
- [x] **2b.** Show the `Scope` description on hover (desktop tooltip) /
  long-press (mobile sheet) on each file entry.

---

## Phase 3 — `create_file` automation

- [x] **3a.** Add `indexed` (bool, default `true`) and `scope`
  (`string | null`, default `null`) fields to the `create_file` op. Validate
  the only allowed combinations: `indexed=true, scope=<non-empty string>` and
  `indexed=false, scope=null`. Python + JS + conformance cases.
- [x] **3b.** When `indexed=true`, runtime automatically appends
  `{"File": "[[<path>]]", "Scope": "<scope>"}` to `Index.json` as part of the
  same batch. Python + JS + conformance cases.
- [x] **3c.** Update skill: always pass a non-empty `scope` with `create_file`;
  never manually add an index entry (the runtime does it).

---

## Phase 4 — End-of-apply enforcement (index and integrity)

- [x] **4a.** Enforce `Index.json` format: must be a JSON array; each entry is
  an object with at minimum `File` (string) and `Scope` (string); `File` must
  be a wikilink of the form `[[<path>]]`. `Scope` must be non-empty. Additional annotation keys are
  permitted.
- [x] **4b.** Enforce: no file-stem / directory-name collision in the same
  parent directory anywhere in the repo (general rule, not sidecar-specific).
- [x] **4c.** Enforce: `Index.json` entries have no duplicate `File` values.
- [x] **4d.** Enforce: every file has an index entry. Excluded are obviously dot-files at the root level, files (recursively) inside dot-dirs at the root level, and CLAUDE.md. Excluded files not only _don't have to be_ in the index, but actually _cannot be_ in the index. (Later we'll add sidecars to the exclusion list.)
- [x] **4e.** Enforce: every wikilink in every file in the repo resolves to an
  existing file. *Note: once this is in place, the existing `delete_path`
  dangling-reference check becomes redundant (the integrity scan covers it) and
  can be removed.*
- [x] **4f.** Update skill: never create a file whose stem matches an existing
  directory name in the same parent (or vice-versa); never use forbidden
  characters (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, null byte) in
  filenames, directory names, or JSON object keys.

---

## Phase 5 — Sidecar core logic

- [x] **5a.** Implement trigger logic: parse a string value with a
  CommonMark-compliant markdown parser and count content blocks (paragraphs,
  headings, fenced code blocks, individual list items, blockquotes). Promote if
  count > 1. Python + JS + conformance cases.
- [x] **5b.** Implement JSON Pointer ↔ `.sidecars/` filepath bidirectional
  mapping. Forward: derive sidecar path from `<stem>.json` + RFC 6901 pointer
  segments. Reverse: strip `.md`, split on `/`, traverse actual JSON to resolve
  int vs. string at each level. Python + JS + conformance cases.
- [x] **5c.** Add sidecars to the list of files excluded from the index.
- [x] **5d.** Implement sidecar promotion in the pipeline (between validation
  and apply): when a `json_patch` `add`/`replace` results in a promotable
  string value, write the `.md` sidecar (using `indexed=false`) and rewrite the
  patch op value to the wikilink. Python + JS + conformance cases. *Partial
  skill update: string values are promoted automatically — don't manually create
  sidecar files or construct wikilinks for inline content.*
- [x] **5e.** `jadelens apply` output reports newly created sidecars (paths and
  the JSON field they came from) so the bot knows what the runtime did.
- [x] **5f.** Enforce sidecar structural invariants at end of apply:
  - **5f-i.** Every `<stem>.sidecars/` directory requires `<stem>.json` to
    exist.
  - **5f-ii.** `<stem>.sidecars/` contains only `.md` files (recursively); no
    non-`.md` files.
  - **5f-iii.** For each sidecar `.md`, its corresponding JSON path must exist
    in `<stem>.json` with the value being exactly the sidecar wikilink.
  - **5f-iv.** A wikilink pointing into any `.sidecars/` directory may only
    appear at the exact JSON field that owns that sidecar; any other occurrence
    is rejected.

---

## Phase 6 — Sidecar propagation (all done at the end of `apply`)

- [x] **6a.** `rename_path` on `<stem>.json` also renames `<stem>.sidecars/`
  to match the new stem (if it exists). *Partial skill update: renaming a JSON
  file also moves its sidecars — no need to do this manually.*
- [x] **6b.** `delete_path` on `<stem>.json` also deletes `<stem>.sidecars/`
  (if it exists). Sidecar wikilinks are forbidden outside their owner field, so
  no wikilink reference check can block this. *Partial skill update: deleting a
  JSON file also deletes its sidecars — no need to do this manually.*
- [x] **6c.** RFC 6902 `move` op within a `json_patch`: if the source path has
  a sidecar subtree in `.sidecars/`, rename that subtree to match the
  destination path. *Partial skill update: moving a JSON field also moves its
  sidecars — no need to do this manually.*
- [x] **6d.** RFC 6902 `remove` op within a `json_patch`: if the field being
  removed holds a sidecar wikilink (directly or nested), auto-delete the sidecar file (or subtree) (and prune
  now-empty parent directories inside `.sidecars/`). *Partial skill update:
  removing a JSON field also deletes its sidecar — no need to do this
  manually.*

---

## Phase 7 — Bot instructions (sidecars, full update)

- [x] **7a.** Update skill with the complete picture of sidecar automation,
  consolidating all partial updates from Phases 5–6: what the runtime handles
  automatically (promotion, JSON file rename/delete propagation, json_patch
  move/remove propagation); what the bot can still do deliberately (edit
  sidecars via `unified_diff`, rename a file into `.sidecars/` to demote a
  primary file to a sidecar); what the bot should never do (manually create
  sidecar files, manually construct wikilinks for inline content, manage sidecar
  files when restructuring JSON).

---

## Phase 8 — Web UI: sidecar display

- [x] **8a.** In the JSON card view, when a field value is a sidecar wikilink,
  render a truncated preview instead: max 1 rendered line, max 100 characters, + `...`. Truncation must respect inline span boundaries (no cutting inside
  inline code, bold, etc.).
- [x] **8b.** Add a ↗ icon to the truncated preview card that navigates to the
  full sidecar view.
- [x] **8c.** Navigating back from the sidecar view to the parent JSON file
  restores the scroll offset. This should already be true, we just need to check.
- [x] **8d.** Sidecar top bar: when viewing a sidecar file, show
  `dir1 / dir2 / <stem>[<json-path>]` (e.g. `Projects / Garden[comparisons/0/description]`) instead of
  the path of the real sidecar file.
- [x] **8e.** Sidecar files are hidden from the file tree automatically once
  Phase 2a is done (they have no index entry). Verify this works and no special
  handling is needed.

---

## Phase 9 — Versioning and migration

- [x] **9a.** Read the versioning design doc and existing migration framework code/docs to understand what has already been designed for the v2 migration (not much, actually). The main goal here is to finish designing, implementing and testing the migration framework. The data changes will be done anyway to help make this exercise realistic (so we're ready for more serious migrations in the future). We'll bump the data-format version, promote all relevant string values to sidecars in one batch, look for any breaches of the new rules we're enforcing (e.g. file-stem/dirname collisions) and either handle them automatically or surface them to the bot for intelligent handling, and finish the migration with a check of every rule.
- [x] **9b.** Implement Python migration helpers for v2. Sub-tasks:

  - [x] **9b-i.** Create `jadelens/migrations/v1_v2/` package (with `__init__.py`) and `helpers.py`. Implement `promote_sidecars(data_repo: Path, stdin_data: dict | None) -> None`: scans every `.json` file in the data repo (excluding `.jade/`), identifies every string value that qualifies for sidecar promotion (>1 content block per the existing trigger logic in `jadelens/sidecar.py`), and emits a `jadelens apply --unsafe` payload (a `json_patch` with `replace` ops for each qualifying value) so the promotion pipeline handles wikilink creation automatically. Prints a structured result to stdout: counts of files scanned, values promoted, sidecars created.
  - [x] **9b-ii.** Add `jadelens run-migration-helper <data_repo> <identifier>` subcommand. `<identifier>` is a `vN_v(N+1)/name` string (e.g. `v1_v2/promote-sidecars`). A match block dispatches to the corresponding helper function. The subcommand reads JSON from stdin and passes it to the function. Raises a clear error for unknown identifiers.
  - [x] **9b-iii.** Tests for `promote_sidecars`: at least one test with a fixture repo containing promotable strings confirms the correct apply payload is emitted and the strings are promoted. Test `run-migration-helper` dispatch: unknown identifier exits with error; known identifier calls the right function.

- [x] **9c.** Write migration runbook for v2 at `jadelens/migrations/v1_v2/RUNBOOK.md`. The runbook is output verbatim to stdout by `jadelens migrate` and followed by the bot. It must:
  - Explicitly instruct the bot to use `apply --unsafe` only for data operations listed in this runbook, and for nothing else during the session.
  - Explicitly instruct the bot not to perform any git operations (commit, push, reset, tag, …), and not to edit or create files directly via its native tools (Edit, Write, shell commands, echo, etc.). All data mutations go through `jadelens apply --unsafe`; all git operations go through `jadelens migrate`.
  - Use `jadelens apply --unsafe` for every data operation.
  - Call `jadelens run-migration-helper <data_repo> v1_v2/promote-sidecars` to batch-promote qualifying strings (the helper handles the apply call internally).
  - Instruct the bot to review the promotion output and flag anything unexpected.
  - Instruct the bot to check for any file-stem/directory-name collisions and resolve them (rename the colliding file, ask the user if intent is unclear).
  - End with `jadelens check <data_repo>` to confirm all v2 invariants pass (see 9f for the `check` subcommand). This is the runbook's final action; it then returns control to the skill. Note: `apply --unsafe` cannot be used for this because `--unsafe` suppresses the enforcement checks; and `apply` in normal mode would reject the call because the data is still at v1.
  - **Not** state the migration identifier — `jadelens migrate` prepends `"Here's the runbook for migration \`vN-v(N+1)\`:\n\n"` before printing the runbook, so the bot always knows the identifier from the header.
  - **Not** bump `.jade/version` and **not** call `jadelens migrate --finalize` itself — those are the skill loop's job, run *after* the runbook finishes via `jadelens migrate --finalize=v1-v2` (see 9g-i; it does the version bump, end tag, and push). `apply` could not do the version bump anyway: it rejects ops on `.jade/` paths (outside the scope of `--unsafe`), and `.jade/version` is not a JSON file.
- [x] **9d.** Add data-format version check to the web app: if data version < supported (2, in this case), warn to use the CLI/skill to migrate the data (even though this is a lie for now, because that's not implemented yet). If data version > supported (2, in this case), warn the user they should reload (and if needed clear the cache and reload again). In both cases, switch to read-only mode (best-effort, might be broken).
- [x] **9e.** Implement `jadelens update`. Sub-tasks:

  - [x] **9e-i.** Add a `post-update` stub subcommand to `jadelens`. Unlike all other subcommands it takes no positional `data_repo` argument; instead it accepts a single optional keyword argument `--data-repo <path>`. For now the handler just prints "post-update: not yet implemented" and exits. Then add the `update` subcommand: no arguments, no logic beyond two sequential `subprocess.run` calls — first `uv tool install --reinstall <package-source>@cli-latest` (the exact uv invocation that reinstalls from the moving git tag; settle the precise command at implementation), second `jadelens post-update`. Add a prominent comment that this function must stay a thin shell-out forever and must never grow additional logic. Add a pytest test that mocks `subprocess.run` and asserts exactly two calls are made with the expected arguments and that no other side effects occur (no file I/O, no other subprocess calls).

  - [x] **9e-ii.** Extract two helpers from `do_init()`:

    **`_collect_config(known: dict) -> dict`** — given a dict of already-known field values (from CLI args in `init`, from the existing `.jade/config.json` in `post-update`), prompt the user interactively for every required config field that is absent from `known`, and return the complete config dict. This is the single place where config prompting lives; both commands call it. The policy: existing keys keep the same path across versions (backwards-compatibility contract), so values from an older config are always valid for their fields; only genuinely new fields require prompting. All prompting must complete before any filesystem writes, so in `init` this is called before cloning, and in `post-update` before any file is touched.

    **`_write_common_files(data_repo, config_dict) -> list[Path]`** — unconditionally writes every file both `init` and `post-update` produce, returns the written paths for the caller to stage:
    - `.jade/config.json` — from `config_dict`.
    - `.claude/hooks/session-start` — from template + config values (written executable).
    - `.claude/settings.json` — from template + config values.
    - `CLAUDE.md` — from template + config values.
    - `.gitignore`.

    The rendered skill is **not** written here; it is written after commit and push.

    Refactor `do_init()` to call `_collect_config()` (with CLI args as `known`) before cloning, then `_write_common_files()` after cloning, extending the returned list with the two init-only files (`Index.json`, `.jade/version`) before staging and committing. `post-update` calls `_collect_config()` (with the existing config as `known`) then `_write_common_files()`, using the returned list directly with no additions.

  - [x] **9e-iii.** Implement `post-update --data-repo=<path>`: single-repo update. The subcommand handler calls `_update_repo(data_repo: Path)`:
    1. **Idempotency check.** Derive the skill file path from the data repo (it lives at `<data_repo>/.claude/skills/<assistant_name>/SKILL.md`, where `assistant_name` comes from `.jade/config.json`). Read the skill marker version. If it matches `jadelens.__version__`, print "Already up to date." and return immediately.
    2. **Dirty-tree check.** Run `git -C <data_repo> status --porcelain`. If there is any output, print a clear warning that names the repo and aborts. Do not touch anything. (On claude.ai, hook stderr surfaces in Claude's context even if invisible to the human user; the apply version guard — 9e-vi — is the fallback signal to the user.)
    3. **Branch switch.** Record the current branch (`git -C <data_repo> rev-parse --abbrev-ref HEAD`). Run `git -C <data_repo> checkout main`. This is necessary because on claude.ai the feature branch may already be checked out when the session-start hook fires.
    4. **Collect config and write common files.** Read `.jade/config.json` and pass its contents as `known` to `_collect_config()`, which prompts for any new required fields and returns the complete config dict. Then call `_write_common_files(data_repo, config_dict)` and capture the returned path list for staging. Config is always written before the skill is re-rendered because the skill template uses config values, and `_write_common_files` writes config first.
    5. **Commit.** Stage the paths returned by `_write_common_files` (`git add -- <paths>`) and commit: `jadelens update: update repo files to cli-v<version>`. Handle "nothing to commit" gracefully — some files may be byte-identical after the rewrite; the push may still be needed to deliver a previously committed but un-pushed update.
    7. **Push.** `git push origin main`. Retry up to 4× with exponential backoff (2 s, 4 s, 8 s, 16 s) on network failure.
    8. **Re-render skill.** Call `do_render_skill(data_repo)`. The skill file is gitignored and is therefore not part of the commit. A correct skill marker version is the completion sentinel: if the process crashes before this step, the next invocation sees the old marker version and reruns from step 1.
    9. Print a success summary: repo path, assistant name, new version.

  - [x] **9e-iv.** Implement `post-update` (no `--data-repo`): multi-repo scan. When `--data-repo` is omitted:
    1. List all entries under `~/.claude/skills/`.
    2. For each entry that is a symlink, resolve it to its target path. Skip broken symlinks with a printed warning.
    3. Read the target markdown file and search for the Jade Lens skill marker comment (the same marker that the apply version guard reads — see 9e-vi; the marker-parsing logic should live in one shared helper used by both). If the marker is absent, skip silently (the skill belongs to a different tool).
    4. Derive the data-repo root from the symlink target (the skill lives at `<data_repo>/.claude/skills/<name>/SKILL.md`; strip the trailing three path components).
    5. Print a clear header: `=== Updating <assistant_name> (<data_repo>) ===`.
    6. Call `_update_repo(data_repo)`.
    7. Continue to the next entry regardless of per-repo errors (log the error and move on so one broken repo does not block others).

    **Testing notes.** `_update_repo` can be fully tested with `tmp_path` fixtures since it only touches the data-repo path it receives. The multi-repo scan (step 1–7 above) requires a fixture that creates real symlinks under a temporary stand-in for `~/.claude/skills/`; pass that directory as a parameter rather than hardcoding `Path.home()` so tests can substitute it. The scan relies on the symlink pointing at the skill *directory* (not `SKILL.md`) — this is the contract documented in `docs/design/claude-code-integration.md`; include a test asserting that the path derivation in step 4 is correct when given a symlink to a directory.

  - [x] **9e-v.** Apply version guard. At the top of `do_apply()`, before `workflow.run()` is called:
    1. Parse the Jade Lens skill marker in the data repo's skill file to extract the embedded CLI version. Use the shared marker-parsing helper from 9e-iv.
    2. Compare with `jadelens.__version__`.
    3. If skill version > code version (CLI is stale — another device ran `jadelens update`): print *"Skill version X is ahead of installed CLI version Y. Run `jadelens update` to update the CLI, then retry."* Abort.
    4. If skill version < code version (skill is stale — CLI was updated but `post-update` did not finish): print *"Installed CLI version Y is ahead of skill version X. Run `jadelens post-update --data-repo=<data_repo_path>` to finish the update, then retry."* Abort.
    5. If equal: continue normally.

  - [x] **9e-vi.** Update the session-start hook template. Near the end of the hook (after `jadelens` is installed/verified), add:
    ```
    git -C "$REPO" checkout main
    jadelens post-update --data-repo="$REPO"
    ```
    The `git checkout main` is required because on claude.ai the environment may have pre-created a feature branch before the hook fires; `post-update` must commit to `main`. Add a comment in the template explaining this. Because `post-update` may overwrite the hook file itself, it must be the last substantive command in the hook. Update `do_init()` to use the updated template. Existing data repos will receive the new hook on their next `jadelens update`.
- [x] **9f.** Add data-format version check to `workflow.run` and a standalone `jadelens check` subcommand. Two parts:

  **9f-i.** Extract the enforcement logic. Move `_post_apply_enforcement_pass` (currently called at the end of `workflow.run`) into a standalone public function `run_enforcement_pass(data_repo: Path)` in `workflow.py`. Both `workflow.run` (when not in `--unsafe` mode) and the new `check` subcommand call this function. No code is duplicated.

  **9f-ii.** Add `jadelens check <data_repo>` subcommand. Calls `run_enforcement_pass(data_repo)` directly — no ops, no commit, no log entry. Exits with a clear error message if any check fails (same errors as the enforcement pass), exits 0 with a success message if all checks pass. This is what the migration runbook uses for its final integrity pass.

  **9f-iii.** Add data-format version check to `workflow.run`. At the start, read `.jade/version`, compare against `__supported_data_format_version__`:
  - `data < supported` and `--unsafe` not set: abort — *"Data is vN, this CLI requires vM. Run `/<assistant>-migrate` to migrate."*
  - `data > supported`: abort — *"Data version vN is newer than this CLI supports (vM). Run `jadelens update`."*
  - `--unsafe` set: skip version check and skip end-of-apply rule enforcement (the `run_enforcement_pass` call is omitted). Still pull. Don't push after committing (leave push to `jadelens migrate`). Print a visually distinct warning line at the start of output (colour + ⚠️ emoji) noting that unsafe mode is active.
  - `data == supported`: proceed normally.
  The `--unsafe` flag is added to the `apply` subcommand's argparse definition and threaded through to `workflow.run` via a parameter.

- [x] **9g.** Implement `jadelens migrate <data_repo>` and the `/<assistant>-migrate` skill. Sub-tasks:

  - [x] **9g-i.** Add `jadelens migrate <data_repo>` subcommand, accepting an optional `--finalize=vN-v(N+1)` argument (same identifier format as the git migration tags). A single command drives the whole state machine: the `/<assistant>-migrate` skill calls it repeatedly, and each call advances the migration by at most one step and prints either the next runbook or `DONE`.

    The skill loop (see 9g-ii):
    1. Call `jadelens migrate <data_repo>` (no `--finalize`).
    2. If it prints a runbook, follow it. The runbook names its own identifier `vN-v(N+1)`.
    3. On successful completion, call `jadelens migrate <data_repo> --finalize=vN-v(N+1)`.
    4. Repeat until a call prints `DONE` instead of a runbook, then tell the user and exit.

    Example: data at v2, CLI supports v4. `migrate` → v2-v3 runbook → `migrate --finalize=v2-v3` → v3-v4 runbook → `migrate --finalize=v3-v4` → `DONE`.

    Each invocation runs two phases:

    **Phase A — finalize (only when `--finalize=vN-v(N+1)` is given).** Completes the migration the bot just finished via the runbook. Operates on the current local HEAD (which holds the runbook's unpushed `--unsafe` commits); does **not** pull first, so the commits being tagged are exactly the ones the runbook produced. All steps idempotent (safe to retry after a crash):
    1. Verify the start tag `vN-v(N+1)-migration-start` exists; otherwise error (nothing to finalize).
    2. If `.jade/version` is still `vN`, write `v(N+1)` and commit `migration: bump data format to v(N+1)`. Skip if already `v(N+1)`.
    3. Create the end tag `vN-v(N+1)-migration-end` at HEAD if absent.
    4. Push branch + tags, retry with exponential backoff on network failure.

    **Phase B — start / resume / done (always runs, after Phase A if any).**
    1. Pull from remote (best-effort fast-forward).
    2. Read `data_version` from `.jade/version`.
    3. If `data_version == __supported_data_format_version__`: print `DONE` and exit.
    4. Otherwise target the migration `vData-v(Data+1)`:
       - No start tag: create + push `vData-v(Data+1)-migration-start`.
       - Start tag exists and HEAD is ahead of it (crash mid-runbook): `git reset --hard <start-tag>`, pull, print a rollback warning ("Rolled back unfinished migration work; restarting the runbook from a clean state.").
       - Start tag exists and HEAD == start tag: clean resume, no rollback.
    5. Print `"Here's the runbook for migration \`vData-v(Data+1)\`:\n\n"` followed by the contents of `jadelens/migrations/vData_v(Data+1)/RUNBOOK.md` to stdout.
  - [x] **9g-ii.** Render and symlink the `/<assistant>-migrate` skill alongside the main skill. Add a `migrate-skill.md` template to `jadelens/templates/`. Wire it into `do_render_skill` (renders both skills) and `_write_common_files` / `post-update` (same lifecycle as the main skill). The migrate skill contains the loop described in `docs/design/versioning.md` ("The `/<assistant>-migrate` skill" section).
  - [x] **9g-iii.** Tests for `jadelens migrate`: fresh start creates start tag and outputs runbook; crash recovery resets and warns; completion creates end tag and prints DONE; multi-version sequence works end-to-end.

---

## Phase 10 — E2E test harness

Design reference: `docs/design/e2e-testing.md`.

- [x] **10a.** Write the e2e testing design doc (`docs/design/e2e-testing.md`).
  Covers: fixture format, sandbox model, two modes (local / `--github`), fake
  HOME, `--add-dir` for bot sessions, PAT-in-URL auth, safety guard pattern,
  migration-tag clearing, `.env.local` contract, web app dev-seed.

- [x] **10b.** Create the first scenario fixture at
  `tests/e2e/fixtures/v1-basic/`. Contents:
  - `.jade/version` — `v1\n`
  - `.jade/config.json` — `{"user": {"full_name": "Test User", "short_name": "Test"}, "assistant": {"name": "jadetest"}}`
  - `Index.json` — `[]`
  - At least two JSON content files whose string values contain more than one
    CommonMark block (paragraphs, headings, list items, code blocks, or
    blockquotes) — these should be promoted to sidecars by the v1→v2 migration
    helper. Check `jadelens/sidecar.py` for what counts as a multi-block value.
  - At least one JSON content file with only single-block string values — should
    not be promoted.
  - All files should use plausible personal-data content (not contrived). Each
    JSON content file that should be in the index needs a corresponding entry in
    `Index.json`. The `.jade/config.json` assistant name must be `jadetest`.

- [x] **10c.** Write `tests/e2e/materialize.py`. Implements the full harness
  script as described in `docs/design/e2e-testing.md`. Detailed spec:

  **Interface:** `python tests/e2e/materialize.py <fixture-name> [--github]`

  **`.env.local` parsing:** read the file at `<repo-root>/.env.local` (two
  levels up from `tests/e2e/`). Parse `KEY=VALUE` lines, ignoring blank lines
  and `#` comments. Expose values by key name, stripping any `VITE_` prefix for
  matching. Error clearly if `.env.local` is missing when `--github` is used.

  **Sandbox creation:** wipe `/tmp/jl-e2e/<fixture-name>/` completely if it
  exists, then create `home/`, `repo/`, and (local mode only) `remote.git/`.

  **Repo materialization (both modes):**
  1. Copy all files from `tests/e2e/fixtures/<fixture-name>/` into `repo/`.
  2. Read `.jade/config.json` from `repo/` to get the config dict.
  3. Write scaffold files by importing `jadelens.cli` and calling
     `_write_common_files(repo_path, config_dict)`. This writes the
     session-start hook, `.claude/settings.json`, CLAUDE.md, and `.gitignore`
     from the installed templates without any interactive prompts or git ops.
  4. `git init -b main`, configure `user.email` and `user.name` (test values),
     `commit.gpgsign false`.
  5. `git add -A && git commit -m "materialize: <fixture-name>"`.

  **Local mode (no `--github`):**
  6. `git init --bare remote.git/`.
  7. `git remote add origin /tmp/jl-e2e/<fixture-name>/remote.git`.
  8. `git push -u origin main`.

  **`--github` mode:**
  6. Read `VITE_JL_E2E_REPO_URL` and `VITE_JL_E2E_PAT` from `.env.local`.
     Extract `owner/repo` from the URL. Validate the repo name (portion after
     `/`) against `r"jade-lens-test(-.+)?"` — exit with a clear error message
     if it doesn't match, before any network call.
  7. Construct the authenticated remote URL:
     `https://<PAT>@github.com/<owner>/<repo>.git`.
  8. `git remote add origin <authenticated-url>`.
  9. List all remote tags via `git ls-remote --tags origin`. Delete any whose
     ref name matches `r"refs/tags/v\d+-v\d+-migration-(start|end)$"` using
     `git push origin --delete <tag> ...` (batch into one call if multiple).
  10. `git push --force -u origin main`.

  **Output:** print a summary block:
  ```
  === Scenario: <fixture-name> ===
  Sandbox:   /tmp/jl-e2e/<fixture-name>/
  Data repo: /tmp/jl-e2e/<fixture-name>/repo/
  Remote:    /tmp/jl-e2e/<fixture-name>/remote.git   [or GitHub URL]

  Run CLI commands in this environment:
    export HOME=/tmp/jl-e2e/<fixture-name>/home
    export PATH="$HOME/.local/bin:$PATH"

  For bot sessions:
    claude --add-dir /tmp/jl-e2e/<fixture-name>/repo
  ```

  **No external dependencies beyond the standard library** — no `python-dotenv`,
  no `requests`. Use `subprocess` for git, `shutil` for file ops, `re` for
  pattern matching, plain string splitting for `.env.local` parsing.

- [x] **10d.** Web app dev-seed and Vite config change. Two parts:

  **`web/src/devSeed.js`:** export an async function `seedDevConfig()`. The
  function body is wrapped in `if (import.meta.env.DEV)` — dead code in
  production builds. When running in dev mode and both `VITE_JL_E2E_REPO_URL`
  and `VITE_JL_E2E_PAT` are set, the function opens the `jade-lens` IndexedDB
  (via `getDB()` from `db.js`), reads the current `config/user` entry, and
  **only if Settings are not already configured** (i.e. `githubRepoUrl` is
  absent or empty):
  1. Writes `{ githubRepoUrl: import.meta.env.VITE_JL_E2E_REPO_URL, githubPat: import.meta.env.VITE_JL_E2E_PAT }` to the `config` store under key `'user'`.

  That is all the seed does. It does **not** clear the `repo`, `sync`, or
  `drafts` stores — cache clearing between scenario runs is always manual
  (`Application → Storage → Clear site data` in browser devtools). The URL and
  PAT never change between materializations (they come from `.env.local`), so
  there is no reliable browser-visible trigger for "a new materialize just ran."
  
  **`web/main.jsx`:** import `seedDevConfig` from `./devSeed.js` and call it
  (fire-and-forget, no `await` needed before render) at the top of the module,
  before `ReactDOM.createRoot`.

  **`vite.config.js`:** add `envDir: path.resolve(__dirname, '..')` to the
  `defineConfig` object so Vite reads `.env.local` from the repo root. Add
  `import { resolve } from 'node:path'` (or use `path.resolve` via the existing
  `node:child_process` import pattern) — check what's already imported.

- [ ] **10e.** Add `.env.local.example` at repo root and verify gitignore.
  Create `.env.local.example` (tracked):
  ```
  # Copy to .env.local and fill in real values.
  # Used by tests/e2e/materialize.py (--github mode) and the web app dev server.
  # Never commit .env.local.
  VITE_JL_E2E_REPO_URL=https://github.com/<owner>/jade-lens-test
  VITE_JL_E2E_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
  ```
  Check `tests/e2e/.gitignore` or the root `.gitignore` — ensure `.env.local`
  is listed. If not already present, add it to the root `.gitignore`.

---

## Phase 11 — Release

Before running the release checklist, exercise the key scenarios using the
phase 10 harness: at minimum, a full v1→v2 migration run (bot-driven) against
`v1-basic`, and the version-mismatch error path in the web app.

- [ ] **11a.** Set code versions: CLI `__version__` → `0.2.0`, web
  `package.json` → `0.2.0`, minimum required data format → `2` in both
  codebases.
- [ ] **11b.** Finalize changelogs: rename each `unreleased.md` to the version
  file (`cli/v0.2.0.md`, `web/v0.2.0.md`, `data-format/v2.md`); create new
  empty `unreleased.md` files.
- [ ] **11c.** Final doc pass: update design docs with anything clarified during
  implementation. Move all future-work items from the top of this file to the
  backlog.
- [ ] **11d.** Clean up planning: delete `sidecar-promotion-decisions.md`;
  remove completed backlog entries (sidecar promotion, versioning, migration
  items).
- [ ] **11e.** Delete this file. Push tags: `cli-v0.2.0`, `web-v0.2.0`; move
  `cli-latest` and `web-latest`; verify GitHub Pages deployment was
  automatically triggered and completed.
