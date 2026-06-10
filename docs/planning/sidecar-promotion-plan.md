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

- [ ] **7a.** Update skill with the complete picture of sidecar automation,
  consolidating all partial updates from Phases 5–6: what the runtime handles
  automatically (promotion, JSON file rename/delete propagation, json_patch
  move/remove propagation); what the bot can still do deliberately (edit
  sidecars via `unified_diff`, rename a file into `.sidecars/` to demote a
  primary file to a sidecar); what the bot should never do (manually create
  sidecar files, manually construct wikilinks for inline content, manage sidecar
  files when restructuring JSON).

---

## Phase 8 — Web UI: sidecar display

- [ ] **8a.** In the JSON card view, when a field value is a sidecar wikilink,
  render a truncated preview instead: max 1 rendered line, max 100 characters, + `...`. Truncation must respect inline span boundaries (no cutting inside
  inline code, bold, etc.).
- [ ] **8b.** Add a ↗ icon to the truncated preview card that navigates to the
  full sidecar view.
- [ ] **8c.** Navigating back from the sidecar view to the parent JSON file
  restores the scroll offset. This should already be true, we just need to check.
- [ ] **8d.** Sidecar top bar: when viewing a sidecar file, show
  `dir1 / dir2 / <stem>[<json-path>]` (e.g. `Projects / Garden[comparisons/0/description]`) instead of
  the path of the real sidecar file.
- [ ] **8e.** Sidecar files are hidden from the file tree automatically once
  Phase 2a is done (they have no index entry). Verify this works and no special
  handling is needed.

---

## Phase 9 — Versioning and migration

- [ ] **9a.** Read the versioning design doc and existing migration framework code/docs to understand what has already been designed for the v2 migration (not much, actually). The main goal here is to finish designing, implementing and testing the migration framework. The data changes will be done anyway to help make this exercise realistic (so we're ready for more serious migrations in the future). We'll bump the data-format version, promote all relevant string values to sidecars in one batch, look for any breaches of the new rules we're enforcing (e.g. file-stem/dirname collisions) and either handle them automatically or surface them to the bot for intelligent handling, and finish the migration with a check of every rule.
- [ ] **9b.** Implement Python migration helper script(s) for v2.
- [ ] **9c.** Write migration runbook for v2 (markdown instructions
  interleaving natural-language steps with calls to the helper(s)).
- [ ] **9d.** Add data-format version check to the web app: if data version < supported (2, in this case), warn to use the CLI/skill to migrate the data (even though this is a lie for now, because that's not implemented yet). If data version > supported (2, in this case), warn the user they should reload (and if needed clear the cache and reload again). In both cases, switch to read-only mode (best-effort, might be broken).
- [ ] **9e.** Implement `jadelens update` (or `jadelens upgrade`?). This probably deserves a few subitems here... *Note: the backlog already has an "Update tool" item with context — read it before designing this.*
- [ ] **9f.** Add data-format version check to `workflow.run` in the CLI: if
  data version < 2, tell the user to run the migration and abort; if data
  version > current, tell the user to update and abort. Confirm check location
  open question first.
- [ ] **9g.** Wire the v2 migration into the CLI/skill invocation path (how the
  user triggers it and how progress/errors are reported).

---

## Phase 10 — Release

- [ ] **10a.** Test end-to-end against a real data repo without pushing release tags. Document what was tested. It is not clear how we can do this. We will probably need somewhat sandboxed installations of arbitrary versions of the CLI and the skill (desktop) (careful with global `jadelens` installation and skill symlink at `~`)? Probably need to launch arbitrary versions of the web app locally (desktop) because GitHub only deploys one version to pages and it's the public version everyone sees. Probably need curated test data for the important test-cases (whole data repos), and either they'll have to live on GitHub for real (and we can have one branch per test-case, set main to the desired branch with --force, test) (or a similar idea but we make it possible to use other branches in the web app and create temporary branches for testing which are removed in the end) or we'll have to build in an adapter to replace GitHub in tests (but that's difficult and more fragile).
- [ ] **10b.** Set code versions: CLI `__version__` → `0.2.0`, web
  `package.json` → `0.2.0`, minimum required data format → `2` in both
  codebases.
- [ ] **10c.** Finalize changelogs: rename each `unreleased.md` to the version
  file (`cli/v0.2.0.md`, `web/v0.2.0.md`, `data-format/v2.md`); create new
  empty `unreleased.md` files.
- [ ] **10d.** Final doc pass: update design docs with anything clarified during
  implementation. Move all future-work items from the top of this file to the
  backlog.
- [ ] **10e.** Clean up planning: delete `sidecar-promotion-decisions.md`; remove completed backlog entries (sidecar promotion, versioning,
  migration items).
- [ ] **10f.** Delete this file. Push tags: `cli-v0.2.0`, `web-v0.2.0`; move `cli-latest` and
  `web-latest`; verify GitHub Pages deployment was automatically triggered and completed.
