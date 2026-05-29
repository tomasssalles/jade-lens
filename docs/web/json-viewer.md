# JSON Card Viewer — Design

The JSON card viewer is the default view for `.json` files in the data repo. Other file types (e.g. markdown) use a plain text view. Future special-purpose views (calendar, kanban, etc.) will override this default for specific data shapes.

---

## Everything is cards

All structured data is rendered as nested cards. A JSON object is a sequence of key–value pairs; each pair is a card. A JSON array is a sequence of elements; each element is a card. This rule applies recursively at every depth with no special cases.

The page background takes the depth-0 card color — there is no visible outer card border. The file's content sits directly on it.

---

## Hierarchy through color and gaps

Depth is communicated by two visual signals:

- **Color**: cards get progressively lighter as nesting deepens, starting from a base color at the outermost level.
- **Gaps**: siblings are separated by a small vertical gap; the parent card's color is visible through these gaps and around child card edges via padding.

On narrow screens (mobile), there is no indentation — color and gaps carry the hierarchy alone. On wide screens, optional per-level indentation adds a third cue.

---

## Collapse and expand

Nested structures (objects and non-trivial arrays) are collapsible. The default state is open. Leaf values are never collapsible. Collapsing hides children in-place — no navigation, no new pages, no popups.

---

## Key labels come from the data

JSON keys are used as display labels verbatim. The bot is instructed to write human-readable keys. The viewer applies no humanization, transformation, or renaming — what the bot wrote is what the user sees. This keeps the view transparent and makes it easy to verify the bot's output.

---

## Value rendering

Lightweight, high-confidence heuristics are applied to render values by type: dates are formatted in locale-aware form, booleans show as ✓ / ✗, nulls as ∅, URLs as clickable links, wikilinks as navigable in-app links, and short string arrays as inline chips. All other strings render as plain text.

Wikilinks (`[[path]]`) navigate to the referenced file within the app, pushing a new entry onto the history stack so the back button returns to the file containing the link.

**Future work:** dead wikilinks (where the target file no longer exists) should be colored distinctly (e.g. red) to signal the broken reference. Currently they render the same as live links.

---

## Text wrapping

All text wraps. Horizontal scrolling for text content is never acceptable, especially on mobile.

---

## Visual tuning

All visual parameters (color palette, spacing, typography, breakpoints) are configurable through an "Advanced settings" section in the app's Settings page. This section is intended for development and is not meant for regular users. The base color is the one parameter that will eventually become a user-facing preference; all others are developer tuning values.
