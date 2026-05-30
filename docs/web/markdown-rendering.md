# Markdown & String Rendering — Design Decisions

This document records the conceptual design decisions for how JADE LENS renders
markdown files and string values within JSON files. It covers both the current
(read-only) version and the planned future (editable) version, with the boundary
between them clearly marked.

---

## Core principle: every string is markdown

All string values in the app — whether they live in a standalone `.md` file or
inline as a JSON string value in the card viewer — are treated as markdown and
rendered through the same markdown renderer.

This eliminates the need for heuristic detection of "is this string markdown or
not?" A string like `"In progress"` contains no markdown syntax and renders
identically to plain text. A string with headings, links, or bold renders as
formatted content. There is no special case, no second code path, no ambiguity.

The cost is a bot instruction: all string values are markdown, so the bot must
escape markdown syntax characters (`#`, `*`, `-`, `[`, `>`, etc. via backslash)
when they appear literally and are not intended as formatting.

### Consequences for the card viewer

The card viewer no longer performs any per-string detection (dates, URLs,
wikilinks). Individual string values are passed directly to the markdown
renderer, which handles all of that internally.

The card viewer retains all JSON-structural responsibilities: distinguishing
value types (boolean → ✓/✗, null → ∅, number → as-is, object/array → nested
cards) and delegating individual strings to the markdown renderer.

**Short string arrays (arrays where every element is a short, plain string)
remain a card viewer concern — they are rendered as inline chips, not passed to
the markdown renderer.** This is an array-level display decision, not a string
rendering decision.

---

## Rendering library: react-markdown (now and long-term)

The app uses `react-markdown` as its sole rendering library for all markdown
content — both standalone `.md` files and inline string values in JSON cards.
The same renderer, same plugins, same custom components, same CSS classes
everywhere.

### Why react-markdown, not a WYSIWYG editor framework

The original plan was to use tiptap (a ProseMirror-based editor framework) in
read-only mode from day one, so that flipping to editable mode later would be
trivial. However, this creates a problem: JSON card views can have many visible
string values (30–50 on a page), and each would need its own editor instance.
ProseMirror instances carry overhead — document model, schema, event listeners,
contenteditable DOM setup — that is unnecessary for read-only display and would
cause perceptible slowness on mobile (Fairphone 4 class devices).

`react-markdown` is stateless and lightweight: it parses a string to an AST and
renders plain React elements. No editor infrastructure, no contenteditable, no
per-instance overhead. Fifty strings on one page render as fifty groups of
simple DOM nodes.

### The editing story (future)

When editing is needed (not in the current version), the plan is:

- **Micro-edits** (toggling checkboxes, picking dates) are handled directly
  within `react-markdown` via custom interactive components. No editor framework
  needed.

- **Full text editing** (writing prose, restructuring content) uses tiptap,
  activated on demand. When the user enters edit mode on a specific field or
  file, the `react-markdown` output for that one item is swapped for a single
  tiptap instance. The user edits, finishes, tiptap serializes back to markdown,
  the mutation is emitted, and the view returns to `react-markdown` rendering.
  There is never more than one tiptap instance active at a time.

- **Visual consistency across the swap**: both `react-markdown` and tiptap
  render to the same DOM elements and apply the same CSS classes (e.g.
  `.jl-wikilink`, `.jl-date`). The swap from reader to editor looks like the
  field simply became editable.

`react-markdown` is not a temporary choice. It is the permanent read-only
renderer. Tiptap is the editing overlay that appears on demand.

---

## Custom rendering within react-markdown

`react-markdown` supports custom components via its `components` prop and
plugins via the remark/rehype ecosystem.

### Wikilinks

Wikilinks (`[[path/to/file.md]]`) are a custom syntax. A custom remark plugin
detects the `[[...]]` pattern in text and produces a custom AST node. A
corresponding React component renders it.

**Display processing:**
- Normalize the path: strip leading `./`, collapse duplicate `/`, strip leading `/`.
- Strip the file extension (uses the same `formatPath` convention as the card
  viewer breadcrumb: any non-dotfile extension removed, path segments joined
  with ` / `).
  - `[[Projects/New language.json]]` → `Projects / New language`

**Visual style:** monospace font, subtle background, distinct color (not the
same blue as URLs), underline. Clickable — navigates to the referenced file.

**Storage:** the markdown source always contains the full canonical path:
`[[projects/kitchen/notes.md]]`. Display processing is rendering-only.

### URLs

Standard markdown autolinks and inline links render via the default `a`
element. Styled distinctly from wikilinks: normal font, blue color, underline,
no background.

### Dates

ISO 8601 date strings (`2026-07-01`, `2026-07-01T14:30`) are detected by regex
within text content. A custom remark plugin identifies them and renders them as
formatted, locale-aware dates (e.g. "Jul 1, 2026") with the raw ISO string as a
tooltip.

**Future:** the date component becomes interactive — tapping opens the native
date picker. This is a micro-edit handled within `react-markdown`; no tiptap.

### Checkboxes / task lists

The `remark-gfm` plugin handles GFM task lists (`- [ ]`, `- [x]`).

**Current version:** rendered but not interactive (no mutation infrastructure
yet).

**Future:** tapping a checkbox emits a unified diff flipping `[ ]` ↔ `[x]` at
the specific line. Micro-edit, no tiptap.

### Syntax highlighting for code blocks

Fenced code blocks with a language tag (e.g. ` ```python `) are syntax-highlighted
using `rehype-highlight` (a rehype plugin wrapping highlight.js) with the GitHub
light theme.

Languages are cherry-picked rather than bundling all of highlight.js:
Python, JavaScript, TypeScript, JSON, Bash, XML/HTML, CSS, SQL, YAML, and INI/TOML.
Unrecognized language tags render as plain monospace — no errors, no fallback
detection.

The GitHub theme is a safe default: it assumes a white background, which matches
the app's lightly tinted depth-0 card color. The theme's colors appear on token
spans (`.hljs-keyword`, etc.) inside `<code>`, while the `<pre>` block keeps the
app's own subtle background (`rgba(0,0,0,0.06)`).

---

## Editing interface (future)

### Bubble toolbar + slash commands

A **bubble toolbar** appears when text is selected (bold, italic, code, link,
etc.). A **slash command menu** appears when the user types `/`. No fixed
toolbar taking permanent screen space — critical for mobile.

### Raw markdown editing

A toggle switches between the WYSIWYG tiptap view and a raw text view. Power-
user escape hatch for desktop users; non-technical users never need it.

### Wikilink creation

When the user types `[[`, an autocomplete dropdown shows files from the data
repo. The user selects; tiptap inserts a wikilink node with the canonical path.
For editing an existing wikilink's target, clicking it reopens the autocomplete.

---

## Theming and visual consistency

### Fonts

IBM Plex Sans for body text, JetBrains Mono for monospace (code, wikilinks) —
the same as the rest of the app.

### Colors

Headings, horizontal rules, and accents use colors derived from the app's base
color (same hue/saturation as the card viewer). Wikilinks and URLs use their
respective configurable colors, delivered via CSS custom properties so the
markdown renderer doesn't need to know about the settings object.

### Shared CSS classes

All custom-rendered elements use named CSS classes prefixed `jl-` (e.g.
`.jl-wikilink`, `.jl-date`, `.jl-checkbox`). Defined once in a shared
stylesheet. When tiptap is eventually introduced, its node views apply the same
classes, ensuring visual identity between read-only and editable states.

---

## What is decided now vs. what stays open

### Decided now
- Every string is markdown. No heuristic detection.
- `react-markdown` is the renderer everywhere (files and card viewer strings).
- Wikilinks, dates, and URLs are handled as custom components/plugins.
- The app uses shared CSS classes for custom elements.
- Checkboxes render but are not interactive in the current version.
- Dates render as formatted text but are not interactive in the current version.
- Fenced code blocks are syntax-highlighted via `rehype-highlight` (GitHub theme, cherry-picked languages).

### Decided in principle, implemented later
- Micro-edits (checkboxes, dates) as interactive `react-markdown` components.
- Full text editing via a single tiptap instance swapped in on demand.
- Bubble toolbar + slash commands for mobile-friendly formatting.
- Raw markdown toggle as a power-user option.
- Wikilink autocomplete during editing.

### Open
- Exact tiptap configuration and extension set.
- Whether raw editing uses a plain textarea or CodeMirror.
- Visual details of the bubble toolbar and slash command menu.
- Whether other micro-edit patterns emerge beyond checkboxes and dates.
