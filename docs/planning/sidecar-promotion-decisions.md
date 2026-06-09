# Sidecar promotion — design decisions

Decisions from the design session on 2025-06-09. This is a planning document
for updating `docs/design/inline-sidecar-promotion.md` and related docs, and
for implementing the feature. It supersedes the open questions and tentative
leanings in the existing design doc.

---

## Core concept

A sidecar is a `.md` file that holds the content of a JSON string value that
grew too large for inline storage. It is structurally equivalent to the JSON
field's value — just stored in a separate file. The pipeline (not the bot)
creates, names, and links sidecars automatically. The UX goal is that sidecars
feel like normal JSON values that happen to expand into their own view, not like
separate files.

---

## Index and file tree

1. **The web UI uses the index (`Index.json`) as its file tree**, not the raw
   filesystem. `Index.json` itself is excluded from the tree. Hover (desktop) /
   long-press (mobile) overlays the `Scope` description from the index entry.

2. **Sidecars are NOT in the index.** No `Load trigger` field, no `reviewed`
   field, no sidecar-related index complexity. The index remains a flat array of
   `{File, Scope}` entries for primary files only.

3. **Every non-sidecar file must have an index entry.** This is the definition
   of which entries must exist. Enforced at the end of `jadelens apply`.

4. **`alwaysLoad`** may be added to index entries in the future for unrelated
   reasons, but it has nothing to do with sidecars.

---

## Index format enforcement

Strictly verified at the end of `jadelens apply`:

- `Index.json` exists and is a JSON array.
- Each element is an object with exactly the keys `File` (string, a wikilink
  of the form `[[<path>]]` pointing to an existing file) and `Scope` (string).
  Additional annotation keys (`alwaysLoad`, `view`, etc.) are permitted.
- Every non-sidecar file in the repo has a corresponding index entry.

---

## Wikilink integrity

**Every wikilink anywhere in the repo must resolve to an existing file.**
Enforced at the end of `jadelens apply`. This generalizes the existing
`delete_path` reference check — it now covers all wikilinks, not just those
affected by a delete.

---

## Promotion trigger

A JSON string value is promoted to a sidecar when it contains **more than one
content block** as parsed by a CommonMark-compliant markdown parser.

Content blocks are: paragraphs, headings, fenced code blocks, individual list
items, blockquotes. The count is of these leaf/item-level blocks, not container
blocks.

Examples:
- A single paragraph (even if 5 raw lines due to wrapping): 1 block, **no
  promotion**.
- A lone heading, or a lone bullet point: 1 block, **no promotion**.
- Two paragraphs (even if only 3 raw lines): 2 blocks, **promoted**.
- A heading followed by a paragraph: 2 blocks, **promoted**.
- Two bullet points: 2 blocks (2 list items), **promoted**.
- A paragraph and a fenced code block: 2 blocks, **promoted**.

Implementation: use `markdown-it` (JS) / `markdown-it-py` (Python) to parse
to tokens and count top-level content blocks. Sub-millisecond for the string
sizes involved. Deterministic across implementations since both use the same
CommonMark-compliant parser.

---

## Scope: when promotion applies

Only `json_patch` `add` or `replace` operations on string values. Specifically:

- `unified_diff` on existing `.md` files passes through untouched.
- A value that is already a wikilink is never re-evaluated for promotion.
- Promotion sits between validation and apply in the pipeline.

**Hysteresis:** a sidecar that shrinks (the linked file's content no longer
meets the trigger) stays a file. No demotion, to prevent oscillation.

---

## Sidecar directory and filename convention

For a JSON file `<stem>.json`, sidecars live in `<stem>.sidecars/`.

The directory structure inside mirrors the JSON path using **JSON Pointer
segments as directory levels**, with array indices as plain integers:

```
Garden.json  path: comparisons -> [0] -> description
  => Garden.sidecars/comparisons/0/description.md

Garden.json  path: notes
  => Garden.sidecars/notes.md

Garden.json  path: phases -> research -> summary
  => Garden.sidecars/phases/research/summary.md
```

The mapping from filename back to JSON path: strip `.md`, split on `/`, each
segment is either a dict key (non-integer) or an array index (integer). This
is the JSON Pointer convention.

**Ambiguity with pure-integer dict keys:** a path segment `0` could be array
index 0 or dict key `"0"`. In practice, pure-integer dict keys are unusual.
The enforcement logic resolves ambiguity by inspecting the actual JSON
structure. If this proves problematic, pure-integer dict keys can be forbidden
— this is left as an implementation-time decision rather than a hard rule now.

---

## JSON key restrictions

The following characters are **forbidden in JSON object keys**, enforced at
`jadelens apply` on any `json_patch` that adds or modifies keys:

- `/` (path separator conflict)
- Null byte
- Windows-unsafe: `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`

This ensures any JSON key can become a valid filesystem path component with
zero escaping. The restriction is minimal — none of these are natural in data
keys.

---

## Reserved paths

`<anything>.sidecars` directories are **reserved for the runtime**. The bot
cannot create, rename into, or directly write files in a `.sidecars/` path.
This extends the existing protected-path concept (which currently covers
dot-prefixed top-level paths).

Additionally, the bot must never give a file the same stem as an existing
directory in the same parent, or vice-versa. This is a general rule (predates
sidecars — it causes UI collisions in the web app's file tree since extensions
are stripped), but sidecars make it explicit: `Garden.json` and
`Garden.sidecars/` coexist by design, but the `.sidecars` suffix distinguishes
them.

---

## Enforcement at the end of `jadelens apply`

For every `<stem>.sidecars/` directory in the repo:

1. `<stem>.json` must exist.
2. Every file in the directory tree must be a `.md` file.
3. For each `.md` file, its path (relative to the `.sidecars/` directory, with
   `.md` stripped, split on `/`) must correspond to a valid path in
   `<stem>.json`.
4. The value at that JSON path must be exactly the wikilink
   `[[<stem>.sidecars/<relative-path>.md]]`.

Conversely: if a value in any JSON file is a wikilink pointing into a
`.sidecars/` directory, the target file must exist (covered by the general
wikilink integrity rule).

These checks together mean a sidecar cannot exist without its owner field, and
an owner field cannot point to a nonexistent sidecar. Orphans are structurally
impossible within a single successful `jadelens apply`.

---

## Propagation on rename, move, delete

- **JSON file renamed/moved:** the `.sidecars/` directory is renamed/moved to
  match. E.g., `Garden.json` → `Plants/Garden.json` also moves
  `Garden.sidecars/` → `Plants/Garden.sidecars/`. Wikilinks inside the JSON
  are rewritten by the existing rename pass.

- **JSON Patch `move` on a key that has sidecars beneath it:** the
  corresponding sidecar subtree is renamed to match. E.g., moving
  `/comparisons` to `/comparisons2` renames
  `Garden.sidecars/comparisons/` → `Garden.sidecars/comparisons2/`. The
  directory-per-key structure makes this a single directory rename.

- **JSON file deleted:** the `.sidecars/` directory is deleted with it. The
  existing wikilink reference check applies — if anything outside the JSON
  references a sidecar (which is forbidden, see below), the delete is refused.

- **JSON Patch `remove` on a field whose value is a sidecar wikilink:** the
  sidecar file (and any now-empty parent directories) is deleted automatically.
  The enforcement rules (point 8 above) would reject the batch anyway if the
  sidecar survived without its owner field, so auto-deletion is the only valid
  outcome. (If this auto-deletion proves complex to implement safely, an
  alternative is to require the bot to include an explicit `delete_path` in the
  same batch — the enforcement catches omissions.)

---

## Sidecar wikilinks are forbidden outside the owner field

A wikilink pointing into any `.sidecars/` directory may **only** appear at the
exact JSON path that owns that sidecar. Any other occurrence — in markdown
prose, in other JSON files, in other fields of the same JSON — is rejected by
the pipeline.

This keeps the invariant tight: one owner, one reference, no indirection
chains.

---

## Web app display

### Card view (JSON file)

When a JSON value is a wikilink to a sidecar, the card view does **not**
display it as a link. Instead it displays a **truncated preview** of the
sidecar's content: max 1 rendered line, max 100 characters, followed by `...`.
Truncation respects inline span boundaries (don't cut in the middle of inline
code, bold, etc.). The preview is tappable/clickable to open the full sidecar.

### Top bar when viewing a sidecar

Instead of showing the raw path (`Garden.sidecars/comparisons/0/description.md`),
the top bar shows a value-style notation: **`Garden[comparisons/0/description]`**.
This reinforces that the user is viewing a value of a JSON file, not an
independent file.

### File tree

Sidecars do not appear in the file tree (the file tree is index-driven, and
sidecars are not in the index).

---

## Bot instructions (skill)

The skill informs the bot:

- Sidecar promotion is automatic. The bot writes string values normally via
  `json_patch`; the runtime decides whether to promote. The bot should **not**
  manually create sidecar files or manually construct wikilinks for inline
  content — the runtime handles it.
- The bot **can** edit existing sidecars via `unified_diff` (the sidecar is a
  normal `.md` file from the bot's perspective once it exists).
- The bot should not use forbidden characters in JSON keys.
- Rename/move/delete propagation for sidecars is automatic — the bot does not
  need to separately manage sidecar files when restructuring JSON.
- The bot should never give a file the same stem as an existing directory in
  the same parent, or vice-versa.

---

## Future: JSON value links *(nice-to-have, not part of sidecar implementation)*

A future wikilink extension to reference any JSON value (not just sidecars):

```
[[Projects/Garden.json:comparisons/0/description]]
```

Displayed as something like **Projects / Garden [comparisons/0/description]**.
Clicking navigates to the JSON file scrolled to that value. If the value
happens to be a sidecar, it opens the sidecar view instead.

This would generalize the sidecar top-bar notation into a referenceable link
format usable in prose and other JSON values. It subsumes the need for
sidecar-specific cross-references (currently forbidden) by making all JSON
values linkable uniformly.

Not needed for sidecar promotion — noted here for future design continuity.
