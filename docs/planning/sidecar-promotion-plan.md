# Sidecar promotion — implementation plan

Working plan for the sidecar promotion feature and the surrounding
infrastructure it requires. Each task is self-contained (implement → test →
commit → push to `claude-ai`). Conformance suite cases belong alongside every
pipeline task and are not listed separately. Changelogs (`docs/changelogs/*/
unreleased.md`) are updated incrementally as tasks complete.

Design reference: `docs/design/inline-sidecar-promotion.md`,
`docs/planning/sidecar-promotion-decisions.md`.

---

## Open questions (settle before starting)

- [ ] **Scope display UX (Phase 2b):** tooltip on hover (desktop) / long-press
  sheet (mobile) on the filename is the current suggestion — confirm or
  override.
- [ ] **Sidecar card interaction (Phase 7a):** suggestion is click/tap = expand
  inline (accordion in card view), with a small "↗" icon to open the full
  sidecar view. Confirm or override.
- [ ] **v2 migration scope (Phase 9):** retroactively promote oversized inline
  strings + ensure every primary file has an index entry — confirm this is the
  full scope.
- [ ] **CLI version check location (Phase 9e):** fire at the top of
  `workflow.run` (same as clean-tree check) — confirm.

---

## Phase 1 — Groundwork

- [ ] **1a.** Identify and read the versioning design doc to confirm the
  mechanics for seeding the v2 data-format requirement in both codebases before
  implementing anything that depends on it.

---

## Phase 2 — Index-driven file tree (web)

- [ ] **2a.** Replace the file tree with an index-driven list built from
  `Index.json`. Exclude `Index.json` itself. Files not in the index are not
  shown.
- [ ] **2b.** Show the `Scope` description on hover (desktop tooltip) /
  long-press (mobile sheet) on each file entry. Settle UX open question first.

---

## Phase 3 — `create_file` automation

- [ ] **3a.** Add `indexed` (bool, default `true`) and `scope`
  (`string | null`, default `null`) fields to the `create_file` op. Validate
  the only allowed combinations: `indexed=true, scope=<non-empty string>` and
  `indexed=false, scope=null`. Python + JS + conformance cases.
- [ ] **3b.** When `indexed=true`, runtime automatically appends
  `{"File": "[[<path>]]", "Scope": "<scope>"}` to `Index.json` as part of the
  same batch. Python + JS + conformance cases.
- [ ] **3c.** Update skill: always pass a non-empty `scope` with `create_file`;
  never manually add an index entry (the runtime does it).

---

## Phase 4 — End-of-apply enforcement (index and integrity)

- [ ] **4a.** Enforce: no file-stem / directory-name collision in the same
  parent directory anywhere in the repo (general rule, not sidecar-specific).
- [ ] **4b.** Enforce: `Index.json` entries have no duplicate `File` values.
- [ ] **4c.** Enforce: every primary file (non-sidecar) has an index entry.
  *Requires Phase 3b to be done first*, otherwise every `create_file` would
  immediately violate this.
- [ ] **4d.** Enforce: every wikilink in every file in the repo resolves to an
  existing file.
- [ ] **4e.** Update skill: never create a file whose stem matches an existing
  directory name in the same parent (or vice-versa); never use forbidden
  characters (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, null byte) in
  filenames, directory names, or JSON object keys.

---

## Phase 5 — Sidecar core logic

- [ ] **5a.** Implement trigger logic: parse a string value with a
  CommonMark-compliant markdown parser and count content blocks (paragraphs,
  headings, fenced code blocks, individual list items, blockquotes). Promote if
  count > 1. Python + JS + conformance cases.
- [ ] **5b.** Implement JSON Pointer ↔ `.sidecars/` filepath bidirectional
  mapping. Forward: derive sidecar path from `<stem>.json` + RFC 6901 pointer
  segments. Reverse: strip `.md`, split on `/`, traverse actual JSON to resolve
  int vs. string at each level. Python + JS + conformance cases.
- [ ] **5c.** Implement sidecar promotion in the pipeline (between validation
  and apply): when a `json_patch` `add`/`replace` results in a promotable
  string value, write the `.md` sidecar (using `indexed=false`) and rewrite the
  patch op value to the wikilink. Python + JS + conformance cases.
- [ ] **5d.** `jadelens apply` output reports newly created sidecars (paths and
  the JSON field they came from) so the bot knows what the runtime did.
- [ ] **5e.** Enforce sidecar structural invariants at end of apply:
  - **5e-i.** Every `<stem>.sidecars/` directory requires `<stem>.json` to
    exist.
  - **5e-ii.** `<stem>.sidecars/` contains only `.md` files (recursively); no
    non-`.md` files.
  - **5e-iii.** For each sidecar `.md`, its corresponding JSON path must exist
    in `<stem>.json` with the value being exactly the sidecar wikilink.
  - **5e-iv.** A wikilink pointing into any `.sidecars/` directory may only
    appear at the exact JSON field that owns that sidecar; any other occurrence
    is rejected.

---

## Phase 6 — Bot instructions (sidecars)

- [ ] **6a.** Update skill: explain sidecar automation (what the runtime handles
  automatically: promotion, top-level rename/delete propagation, patch
  move/remove propagation). Tell the bot it can still edit sidecars via
  `unified_diff` and may deliberately rename a file into `.sidecars/` when
  appropriate. Tell the bot not to manually create sidecar files or construct
  wikilinks for inline content.

---

## Phase 7 — Sidecar propagation

- [ ] **7a.** `rename_path` on `<stem>.json` also renames `<stem>.sidecars/`
  to match the new stem (if it exists).
- [ ] **7b.** `delete_path` on `<stem>.json` also deletes `<stem>.sidecars/`
  (if it exists). Sidecar wikilinks are forbidden outside their owner field, so
  no wikilink reference check can block this.
- [ ] **7c.** RFC 6902 `move` op within a `json_patch`: if the source path has
  a sidecar subtree in `.sidecars/`, rename that subtree to match the
  destination path.
- [ ] **7d.** RFC 6902 `remove` op within a `json_patch`: if the field being
  removed holds a sidecar wikilink, auto-delete the sidecar file (and prune now-
  empty parent directories inside `.sidecars/`).

---

## Phase 8 — Web UI: sidecar display

- [ ] **8a.** In the JSON card view, when a field value is a sidecar wikilink,
  render a truncated preview instead (max 1 rendered line, max 100 characters,
  + `...`). Truncation must respect inline span boundaries. Settle interaction
  model open question before implementing.
- [ ] **8b.** Implement the sidecar interaction: click/tap to expand inline
  (accordion) with a separate "↗" icon to navigate to the full sidecar view (or
  whatever interaction model is decided in the open questions).
- [ ] **8c.** Sidecar top bar: when viewing a sidecar file, show
  `<stem>[<json-path>]` (e.g. `Garden[comparisons/0/description]`) instead of
  the raw file path.
- [ ] **8d.** Sidecar files are hidden from the file tree automatically once
  Phase 2a is done (they have no index entry). Verify this works and no special
  handling is needed.

---

## Phase 9 — Versioning and migration

- [ ] **9a.** Specify the exact v2 migration steps (what runs on the data repo).
  Expected scope: retroactively promote oversized inline strings to sidecars;
  ensure every primary file has an index entry. Confirm open question first.
- [ ] **9b.** Implement Python migration helper scripts for v2.
- [ ] **9c.** Write migration runbook (`docs/` or `migrations/v2.md`) — markdown
  instructions interleaving natural-language steps with calls to the helpers.
- [ ] **9d.** Add data-format version check to the web app: if data version < 2,
  warn + switch to read-only mode; if data version > current, prompt reload +
  clear cache.
- [ ] **9e.** Add data-format version check to `workflow.run` in the CLI: if
  data version < 2, tell the user to run the migration and abort; if data
  version > current, tell the user to update and abort. Confirm check location
  open question first.
- [ ] **9f.** Wire the v2 migration into the CLI/skill invocation path (how the
  user triggers it and how progress/errors are reported).

---

## Phase 10 — Release

- [ ] **10a.** Test end-to-end against a real data repo without pushing release
  tags. Document what was tested.
- [ ] **10b.** Set code versions: CLI `__version__` → `0.2.0`, web `package.json`
  → `0.2.0`, minimum required data format → `2` in both codebases.
- [ ] **10c.** Finalize changelogs: rename each `unreleased.md` to the version
  file (`cli/v0.2.0.md`, `web/v0.2.0.md`, `data-format/v2.md`); create new
  empty `unreleased.md` files.
- [ ] **10d.** Final doc pass: update design docs with anything clarified during
  implementation.
- [ ] **10e.** Clean up planning: delete `sidecar-promotion-decisions.md` and
  this file; remove completed backlog entries (sidecar promotion, versioning,
  migration items).
- [ ] **10f.** Push tags: `cli-v0.2.0`, `web-v0.2.0`; move `cli-latest` and
  `web-latest`; verify GitHub Pages deployment triggered and completed.
