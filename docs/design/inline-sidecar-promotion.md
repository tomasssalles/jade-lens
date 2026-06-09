# Inline-vs-sidecar promotion *(planned — not built)*

> **Status: not implemented.** This is intended design, tracked in
> `docs/planning/backlog.md`. The detailed decisions are recorded in
> `docs/planning/sidecar-promotion-decisions.md`. Today there is no promotion
> in the pipeline and the skill does **not** instruct the bot about it; the bot
> creates `.md` files by hand via `create_file` + a wikilink when it judges
> fit.

Prose lives **inline** as a JSON string when small, and in a **separate `.md`
file** (a "sidecar") referenced by a wikilink when it grows. The runtime makes
that transition automatically — the bot never has to decide — so the same
content is routed the same way every time, independent of bot mood or vendor,
and the bot spends one patch op instead of two-plus.

The UX goal is that sidecars feel like normal JSON values that happen to expand
into their own view, not like separate files. The enforcement rules (see below)
make sidecars structurally equivalent to JSON field values: one owner field,
one file, no independent existence.

Related: [mutation-pipeline.md](mutation-pipeline.md) (where this step slots in),
[wikilinks.md](wikilinks.md) (the reference it produces),
[data-model.md](data-model.md) (the index, which sidecars stay out of).

## The rule

When the bot emits a JSON Patch `add` or `replace` on a string value, the
runtime computes the resulting value and checks whether it contains **more than
one content block** as parsed by a CommonMark-compliant markdown parser.

Content blocks counted: paragraphs, headings, fenced code blocks, individual
list items, blockquotes. The count is of these leaf/item-level blocks, not
container blocks (so a list with 2 items = 2 blocks, not 1).

Examples:
- Single paragraph (even 5 raw lines due to word-wrap): 1 block → **no promotion**
- Lone heading, or lone bullet point: 1 block → **no promotion**
- Two paragraphs (even only 3 raw lines): 2 blocks → **promoted**
- Heading followed by a paragraph: 2 blocks → **promoted**
- Two bullet points: 2 blocks (2 list items) → **promoted**
- Paragraph + fenced code block: 2 blocks → **promoted**

Implementation: use `markdown-it` (JS) / `markdown-it-py` (Python) to parse
to tokens and count top-level content blocks. Sub-millisecond for the string
sizes involved. Deterministic across implementations since both runtimes use
the same CommonMark-compliant parser. Like everything else in the pipeline, this
must be byte-identical across clients and covered by the conformance suite.

**Scope.** Only `json_patch` `add` or `replace` ops on string values. A value
that is already a wikilink (starts and ends with `[[...]]`) is never
re-evaluated for promotion. Unified-diff updates to existing `.md` files pass
through untouched. Promotion sits between validation and apply in `workflow.run`
/ `web/src/mutation/`.

**Hysteresis.** A sidecar that shrinks (the linked file's content would no
longer meet the trigger) stays a file. No demotion, to prevent oscillation at
the boundary.

**Why programmatic, not bot-driven.** Saves the bot output tokens (one op, not
two-plus); deterministic routing; removes a prediction burden from the bot.

## Sidecar filenames and directory convention

For a JSON file `<stem>.json`, sidecars live in `<stem>.sidecars/`.

The directory structure inside mirrors the JSON path using JSON Pointer segments
as directory levels (RFC 6901 convention). Array indices are plain integers;
object keys are path segments as-is.

```
Garden.json  path: notes
  => Garden.sidecars/notes.md

Garden.json  path: comparisons -> index 0 -> description
  => Garden.sidecars/comparisons/0/description.md

Garden.json  path: phases -> research -> summary
  => Garden.sidecars/phases/research/summary.md
```

Reversing a filename to a JSON path: strip `.md`, split on `/`, each segment
is an array index if it is a non-negative integer, otherwise an object key.

**Note on integer object keys.** A path segment `0` is ambiguous (array index
vs. object key `"0"`). In practice pure-integer object keys are rare. The
enforcement logic resolves ambiguity by inspecting the actual JSON structure.
If this proves problematic, pure-integer object keys can be forbidden — left
as an implementation-time decision.

## JSON key restrictions

The following characters are forbidden in JSON object keys, enforced at
`jadelens apply` on any `json_patch` that adds or modifies keys:

`/`, null byte, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`

This ensures any key can become a valid filesystem path component with zero
escaping. The restriction is minimal — none of these are natural in data keys.

Additionally, the bot must never give a file the same stem as an existing
directory in the same parent, or vice-versa. This is a general rule (UI
collision in the web app, which strips file extensions) but bears explicit
mention here because `Garden.json` and `Garden.sidecars/` coexist by design —
the `.sidecars` suffix distinguishes them cleanly.

## Reserved paths

`<anything>.sidecars` directories are reserved for the runtime. The bot cannot
create, rename into, or write files under a `.sidecars/` path directly. This
extends the protected-path concept (currently covering dot-prefixed top-level
paths) to the `.sidecars` suffix.

## Enforcement

The following are checked at the end of `jadelens apply`, after all ops have
been applied:

**Sidecar structural invariants.** For every `<stem>.sidecars/` directory:
1. `<stem>.json` exists.
2. Every file in the directory tree is a `.md` file (no subdirectories
   containing non-`.md` files, no non-`.md` files).
3. For each `.md` file, the corresponding JSON path must exist in `<stem>.json`
   and its value must be exactly the wikilink
   `[[<stem>.sidecars/<relative-path>.md]]`.

**Wikilink integrity.** Every wikilink anywhere in the repo resolves to an
existing file. (This is a general invariant, not sidecar-specific — see
[wikilinks.md](wikilinks.md).)

**Sidecar wikilinks are forbidden outside the owner field.** A wikilink
pointing into any `.sidecars/` directory may only appear at the exact JSON path
that owns that sidecar. Any other occurrence — in markdown prose, in other JSON
files, in other fields of the same JSON — is rejected. This keeps the invariant
tight: one owner, one reference, no indirection chains.

Together these mean a sidecar cannot exist without its owner field, and an
owner field cannot point to a nonexistent sidecar. Orphaned sidecars are
structurally impossible within a successful `jadelens apply`.

## Propagation on rename, move, delete

- **JSON file renamed/moved:** the `.sidecars/` directory is renamed/moved to
  match. Wikilinks inside the JSON are rewritten by the existing rename pass.

- **JSON Patch `move` on a key with sidecars beneath it:** the corresponding
  sidecar subtree is renamed to match (e.g., moving `/comparisons` to
  `/comparisons2` renames `Garden.sidecars/comparisons/` →
  `Garden.sidecars/comparisons2/`). The directory-per-key structure makes this
  a single directory rename.

- **JSON file deleted:** the `.sidecars/` directory is deleted with it. Because
  sidecar wikilinks are forbidden outside the owner field, no wikilink reference
  check can block this.

- **JSON Patch `remove` on a field whose value is a sidecar wikilink:** the
  sidecar file (and any now-empty parent directories inside `.sidecars/`) is
  deleted automatically. The enforcement rules would reject the batch if the
  sidecar survived without its owner field, so auto-deletion is the only valid
  outcome. If auto-deletion proves complex to implement safely, an alternative
  is to require the bot to include an explicit `delete_path` in the same batch —
  the enforcement catches omissions either way.

## Web app display

**Card view.** When a JSON value is a wikilink to a sidecar, the card view
displays a truncated preview of the sidecar's content — max 1 rendered line,
max 100 characters, followed by `...`. Truncation respects inline span
boundaries (no cutting in the middle of inline code, bold, etc.). The preview
is tappable/clickable to open the full sidecar.

**Top bar.** When viewing a sidecar, the top bar shows a value-style notation:
`<stem>[<json-path>]` (e.g. `Garden[comparisons/0/description]`), not the raw
file path. This reinforces that the user is viewing a value of a JSON file.

**File tree.** Sidecars do not appear in the file tree. The file tree is
index-driven, and sidecars are not in the index.

## Bot instructions

The skill informs the bot:

- Sidecar promotion is automatic. Write string values normally via
  `json_patch`; the runtime decides whether to promote. Do not manually create
  sidecar files or construct wikilinks for inline content.
- Existing sidecars can be edited via `unified_diff` on the `.md` file.
- Rename/move/delete propagation for sidecars is automatic — no need to
  separately manage sidecar files when restructuring JSON.
- Forbidden characters in JSON keys are enforced.

## Indexing

Sidecars are **not indexed**. They are discoverable only through the wikilink
held in their owner JSON field. Auto-promoted sidecars never receive an index
entry. The manual `create_file` path remains for content that deserves its own
primary-file slot in the index (discoverability, direct navigation).

## Future: JSON value links *(not part of sidecar implementation)*

A future wikilink extension to reference any JSON value (not just sidecars):

```
[[Projects/Garden.json:comparisons/0/description]]
```

Displayed as e.g. **Projects / Garden [comparisons/0/description]**. Clicking
navigates to the JSON file scrolled to that value; if the value is a sidecar,
it opens the sidecar view. This would generalize the sidecar top-bar notation
into a referenceable link format usable uniformly in prose and other JSON
values. Not needed for sidecar promotion — noted here for design continuity.

## Implementation notes (when built)

- Lands in **both** pipelines (Python + JS) and the conformance suite together —
  it changes the bytes a `json_patch` produces, so it's part of the byte-identity
  contract ([mutation-pipeline.md](mutation-pipeline.md)).
- Slots between validation and apply in `workflow.run` / [web/src/mutation/](../../web/src/mutation/).
- A natural first **migration** ([versioning.md](versioning.md)): retroactively promote existing
  oversized inline strings once the rule exists.
