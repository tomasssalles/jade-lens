# Inline-vs-sidecar promotion *(planned — not built)*

> **Status: not implemented.** This is intended design, tracked in
> `docs/planning/backlog.md`. Today there is no promotion in the pipeline and the
> skill does **not** instruct the bot about it; the bot creates `.md` files by
> hand via `create_file` + a wikilink when it judges fit. This doc describes the
> feature we mean to build; lock the open questions before implementing.

Prose lives **inline** as a JSON string when small, and in a **separate `.md`
file** (a "sidecar") referenced by a wikilink when it grows. The intent is that
the *runtime* makes that transition automatically — the bot never has to decide —
so the same content is routed the same way every time, independent of bot mood or
vendor, and the bot spends one patch op instead of two-plus.

Related: `mutation-pipeline.md` (where this step slots in), `wikilinks.md` (the
reference it produces), `data-model.md` (the index, which auto-promoted sidecars
stay out of).

## The rule

When the bot emits a JSON Patch `add` or `replace` on a string value, the runtime
computes the resulting value and checks:

- line count ≥ 3, **or**
- structural markdown markers present (headings, list bullets, fenced code,
  multiple paragraphs).

If either trigger fires, the runtime:

1. writes the content to a new `.md` sidecar at a derived path,
2. rewrites the patch so the value becomes a wikilink to the sidecar
   (e.g. `"notes": "[[projects/leasing/notes.md]]"`),
3. applies the rewritten patch.

**Hysteresis on demotion.** A sidecar that *shrinks* back to 1–2 lines stays a
file — no demotion, to prevent oscillation at the boundary.

**Scope.** Only JSON Patch ops on inline string values. Unified-diff updates to
existing `.md` files pass through untouched — the bot already sees a wikilink, not
an inline string, and diffs the linked file directly.

**Why programmatic, not bot-driven.** Saves the bot output tokens (one op, not
two-plus); deterministic routing; removes a prediction burden from the bot.

## Indexing: the one thing promotion can't decide

An **auto-promoted sidecar is not indexed** — it's discoverable only via the JSON
wikilink that points at it. That's right for "this is just the prose body of a
field on a parent record." When content deserves discoverability as a **primary**
file in its own right (its own index entry, findable without going through a
parent), the bot does the promotion **manually**: a `create_file` for the `.md`, a
`json_patch` adding the wikilink where it belongs, and an index entry describing
the new primary file. Automatic path for incidental prose; manual path for content
that earns its own slot in the map of the data.

## Sidecar filenames (open)

Three conventions were weighed:

| Convention | Pros | Cons |
|---|---|---|
| **Hash names** | Stable, deterministic, never collide | Opaque; uninformative |
| **JSON-path + key-path** (`projects/leasing__comparisons__notes.md`) | Highly informative | Renaming the parent JSON/key needs a sidecar rename to stay aligned |
| **Sidecar directory per JSON** (`projects/leasing.json` ↔ `projects/leasing/<key-path>.md`) | Sidecars travel with their parent as a unit; readable names | Slightly deeper nesting |

**Leaning sidecar-directory** — cleanest refactor story, still informative. Not
locked; decide at implementation.

## Implementation notes (when built)

- Lands in **both** pipelines (Python + JS) and the conformance suite together —
  it changes the bytes a `json_patch` produces, so it's part of the byte-identity
  contract (`mutation-pipeline.md`).
- Slots between validation and apply in `workflow.run` / `web/src/mutation/`.
- A natural first **migration** (`versioning.md`): retroactively promote existing
  oversized inline strings once the rule exists.
