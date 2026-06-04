# Markdown & String Rendering — Technical Spec

This spec covers the implementation of markdown rendering for the current
(read-only) version of JADE LENS. It provides detailed guidance for integrating
`react-markdown` into both standalone markdown file views and inline string
values in the JSON card viewer.

---

## 1. Package setup

### Required packages

```bash
npm install react-markdown remark-gfm rehype-highlight
```

- `react-markdown`: the core renderer.
- `remark-gfm`: GFM (task lists, strikethrough, tables, autolinks).
- `rehype-highlight`: syntax highlighting via highlight.js (MIT).

### Required for custom plugins

```bash
npm install unist-util-visit
```

- `unist-util-visit`: walks the AST for the wikilink and date plugins.

All packages are MIT licensed.

---

## 2. Core renderer component

A single shared `MarkdownRenderer` component wraps `react-markdown` with all
plugins and custom components. Used everywhere — markdown file pages and card
viewer string values.

```jsx
// src/MarkdownRenderer.jsx
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkWikilinks from './plugins/remarkWikilinks'
import remarkDates from './plugins/remarkDates'
import WikilinkNode from './nodes/WikilinkNode'
import DateNode from './nodes/DateNode'
import './markdown.css'

const remarkPlugins = [remarkGfm, remarkWikilinks, remarkDates]

// inline=true: suppresses paragraph margins for card viewer string values
export default function MarkdownRenderer({ content, onWikilinkClick, inline = false }) {
  const components = useMemo(() => ({
    wikilink: ({ path }) => (
      <WikilinkNode path={path} onWikilinkClick={onWikilinkClick} />
    ),
    inlinedate: ({ iso }) => <DateNode iso={iso} />,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="jl-url">
        {children}
      </a>
    ),
    input: ({ type, checked }) => {
      if (type === 'checkbox') {
        return <input type="checkbox" checked={checked} readOnly disabled className="jl-checkbox" />
      }
      return <input type={type} />
    },
  }), [onWikilinkClick])

  return (
    <div className={`jl-markdown${inline ? ' jl-inline-markdown' : ''}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
```

### Usage in the card viewer (`RenderValue`, string branch)

```jsx
// Before
if (typeof value === 'string') {
  return (
    <Card depth={depth} s={s} isWide={isWide}>
      {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
      {renderStringValue(value, s, onWikilinkClick)}
    </Card>
  )
}

// After
if (typeof value === 'string') {
  return (
    <Card depth={depth} s={s} isWide={isWide}>
      {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
      <MarkdownRenderer content={value} onWikilinkClick={onWikilinkClick} inline />
    </Card>
  )
}
```

The `renderStringValue`, `isDate`, `formatDate`, `isUrl`, `normalizeWikilinkPath`
helpers in the card viewer are removed; their responsibilities move into the
markdown renderer.

### Usage for standalone markdown files

```jsx
export default function MarkdownFilePage({ filePath, content, settings, onWikilinkClick, onBack }) {
  return (
    <div style={{ background: getCardColor(0, settings), minHeight: '100%', ... }}>
      <FileBreadcrumb filePath={filePath} s={settings} onBack={onBack} />
      <div className="jl-file-content">
        <MarkdownRenderer content={content} onWikilinkClick={onWikilinkClick} />
      </div>
    </div>
  )
}
```

`FileBreadcrumb` is the same component used by the JSON card viewer, extracted
to a shared file so both can import it.

---

## 3. Wikilink plugin

### 3.1 Remark plugin (`src/plugins/remarkWikilinks.js`)

```js
import { visit, SKIP } from 'unist-util-visit'

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

export default function remarkWikilinks() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!WIKILINK_RE.test(node.value)) return
      WIKILINK_RE.lastIndex = 0

      const children = []
      let last = 0
      let m
      while ((m = WIKILINK_RE.exec(node.value)) !== null) {
        if (m.index > last) {
          children.push({ type: 'text', value: node.value.slice(last, m.index) })
        }
        children.push({
          type: 'wikilink',
          data: { hName: 'wikilink', hProperties: { path: m[1] } },
          children: [],
        })
        last = WIKILINK_RE.lastIndex
      }
      if (last < node.value.length) {
        children.push({ type: 'text', value: node.value.slice(last) })
      }

      parent.children.splice(index, 1, ...children)
      return [SKIP, index + children.length]
    })
  }
}
```

### 3.2 React component (`src/nodes/WikilinkNode.jsx`)

The display text uses the same `formatPath` convention as the breadcrumb:
extension stripped, segments joined with ` / `.

```jsx
import { normalizeWikilinkPath, formatPath } from '../pathUtils'

export default function WikilinkNode({ path, onWikilinkClick }) {
  const normalized = normalizeWikilinkPath(path)
  return (
    <a
      href="#"
      onClick={e => { e.preventDefault(); onWikilinkClick?.(normalized) }}
      className="jl-wikilink"
    >
      {formatPath(normalized)}
    </a>
  )
}
```

### 3.3 Plugin ordering

Use `[remarkGfm, remarkWikilinks, remarkDates]`. If wikilinks inside GFM
autolinks cause issues, swap to `[remarkWikilinks, remarkDates, remarkGfm]`.

---

## 4. Date plugin

### 4.1 Remark plugin (`src/plugins/remarkDates.js`)

```js
import { visit, SKIP } from 'unist-util-visit'

// Matches ISO 8601: date-only, naive datetime, UTC, and offset datetimes
const DATE_RE = /\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)\b/g

export default function remarkDates() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!DATE_RE.test(node.value)) return
      DATE_RE.lastIndex = 0

      const children = []
      let last = 0
      let m
      while ((m = DATE_RE.exec(node.value)) !== null) {
        if (m.index > last) {
          children.push({ type: 'text', value: node.value.slice(last, m.index) })
        }
        children.push({
          type: 'inlinedate',
          data: { hName: 'inlinedate', hProperties: { iso: m[1] } },
          children: [],
        })
        last = DATE_RE.lastIndex
      }
      if (last < node.value.length) {
        children.push({ type: 'text', value: node.value.slice(last) })
      }

      parent.children.splice(index, 1, ...children)
      return [SKIP, index + children.length]
    })
  }
}
```

### 4.2 React component (`src/nodes/DateNode.jsx`)

```jsx
function formatDate(iso) {
  try {
    const d = new Date(iso)
    if (isNaN(d)) return iso
    if (iso.length === 10) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

export default function DateNode({ iso }) {
  return <span className="jl-date" title={iso}>{formatDate(iso)}</span>
}
```

### 4.3 Edge cases

- `\b` boundaries mean dates inside URLs are usually not matched (URLs contain
  `/` which is non-word).
- Dates inside wikilink paths are safe: the wikilink plugin runs first and
  converts those text segments into `wikilink` nodes, so the date plugin never
  sees them.

---

## 5. CSS classes and styling (`src/markdown.css`)

All custom elements use `jl-` prefixed CSS classes. Colors that depend on the
configurable base color are delivered via CSS custom properties set on
`document.documentElement` by `applySettingsCssVars()` in `viewerSettings.js`
whenever settings change.

```css
/* Wikilinks */
.jl-wikilink {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: rgba(0,0,0,0.04);
  border-radius: 3px;
  padding: 1px 5px;
  text-decoration: underline;
  text-decoration-color: var(--jl-wikilink-color-faded);
  text-underline-offset: 2px;
  color: var(--jl-wikilink-color, #00965a);
  cursor: pointer;
}
.jl-wikilink:hover { background: rgba(0,0,0,0.08); }

/* URLs */
.jl-url {
  color: var(--jl-url-color, #2563eb);
  text-decoration: underline;
  text-decoration-color: var(--jl-url-color-faded);
  text-underline-offset: 2px;
  word-break: break-all;
}

/* Dates */
.jl-date { /* tooltip only for now; cursor: pointer when interactive */ }

/* Checkboxes */
.jl-checkbox { margin-right: 6px; cursor: default; }

/* Inline markdown in cards — collapse paragraph wrapper */
.jl-inline-markdown p { margin: 0; display: inline; }

/* Markdown container */
.jl-markdown {
  font-family: var(--font-sans);
  line-height: 1.5;
  word-break: break-word;
  overflow-wrap: anywhere;
}

/* Headings */
.jl-markdown h1, .jl-markdown h2, .jl-markdown h3,
.jl-markdown h4, .jl-markdown h5, .jl-markdown h6 {
  color: var(--jl-title-color);
  font-weight: 700;
}

/* Inline code */
.jl-markdown code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: rgba(0,0,0,0.06);
  border-radius: 3px;
  padding: 1px 5px;
}

/* Code blocks */
.jl-markdown pre {
  background: rgba(0,0,0,0.06);
  border-radius: 5px;
  padding: 10px 12px;
  overflow-x: auto;
}
.jl-markdown pre code { background: none; padding: 0; }

/* Blockquotes */
.jl-markdown blockquote {
  border-left: 3px solid var(--jl-border-color);
  margin-left: 0;
  padding-left: 12px;
  opacity: 0.85;
}

/* Horizontal rules */
.jl-markdown hr {
  border: none;
  border-top: 1px solid var(--jl-border-color);
  margin: 12px 0;
}
```

### CSS custom properties (set via `applySettingsCssVars` in viewerSettings.js)

```js
export function applySettingsCssVars(settings) {
  const root = document.documentElement
  root.style.setProperty('--jl-wikilink-color', settings.wikilinkColor)
  root.style.setProperty('--jl-wikilink-color-faded', settings.wikilinkColor + '66')
  root.style.setProperty('--jl-url-color', settings.urlColor)
  root.style.setProperty('--jl-url-color-faded', settings.urlColor + '66')
  root.style.setProperty('--jl-title-color', getTitleColor(settings))
  root.style.setProperty('--jl-border-color', getBorderColor(settings))
}
```

Called from a `useEffect` in `App.jsx` that depends on `viewerSettings`, so
vars stay in sync whenever settings change.

---

## 6. Inline markdown in the card viewer

When markdown is rendered inline next to a key label in a card, `react-markdown`
wraps content in `<p>` by default, causing a line break between the key label
and the value.

The fix is `.jl-inline-markdown { p { margin: 0; display: inline; } }`. This
class is applied only in the card viewer context (`inline` prop on
`MarkdownRenderer`). Standalone markdown file pages use normal block styling.

---

## 7. What to remove from the card viewer

Once `MarkdownRenderer` is wired in, these functions are deleted from
`JsonCardViewer.jsx`:

- `isDate()`, `formatDate()`, `isUrl()` — moved to `DateNode.jsx`
- `normalizeWikilinkPath()` — moved to `pathUtils.js`
- `renderStringValue()` — replaced by `<MarkdownRenderer inline />`

These stay in the card viewer:

- Boolean rendering (✓/✗), null (∅), number — not strings.
- `isShortStringArray` + chip rendering — array-level, not string rendering.
- `formatPath` — still used for the file breadcrumb.
- All structural logic: depth coloring, nesting, collapsing, cards.

---

## 8. Standalone markdown file pages

Markdown file pages use `MarkdownRenderer` without `inline`:

- Background: `getCardColor(0, settings)` (same depth-0 card color as JSON viewer).
- `FileBreadcrumb` (shared with JSON viewer) at the top.
- Markdown content fills the page below with appropriate padding.
- Standard block-level styling (paragraph margins, heading sizes) — no
  `.jl-inline-markdown`.

---

## 9. Syntax highlighting

### Packages

`rehype-highlight` is a rehype plugin that applies highlight.js tokenization to
fenced code blocks. Languages are cherry-picked to avoid bundling all of
highlight.js (~1 MB minified).

### Configuration

```js
import rehypeHighlight from 'rehype-highlight'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'     // covers HTML too
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import ini from 'highlight.js/lib/languages/ini'     // covers TOML too
import 'highlight.js/styles/github.css'

const rehypePlugins = [[rehypeHighlight, {
  languages: { python, javascript, typescript, json, bash, xml, css, sql, yaml, ini },
  detect: false,       // no auto-detection when language tag is absent
  ignoreMissing: true, // unknown language tags → plain monospace, no error
}]]
```

Pass to `ReactMarkdown` alongside the existing `remarkPlugins`:

```jsx
<ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
  {content}
</ReactMarkdown>
```

### CSS interaction

`github.css` sets `background: #fff` on `.hljs`. Our `.jl-markdown pre code`
rule resets this with `background: none !important` so the `<pre>` block keeps
the app's own tinted background. Token colors from `.hljs-*` classes are
unaffected.

---

## 10. Future: making checkboxes interactive

1. Remove `disabled` from the checkbox `input` component.
2. Add `onChange` that: determines the line number of the checkbox, computes a
   unified diff flipping `[ ]` ↔ `[x]`, emits via the mutation system.
3. Add `cursor: pointer` to `.jl-checkbox`.

No architectural changes. No new libraries. No tiptap.

---

## 11. Future: making dates interactive

Modify `DateNode` to show a native date picker on tap:

```jsx
export default function DateNode({ iso, onDateChange }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        type={iso.length > 10 ? 'datetime-local' : 'date'}
        defaultValue={iso}
        className="jl-date-picker"
        autoFocus
        onBlur={e => {
          setEditing(false)
          if (e.target.value !== iso) onDateChange?.(iso, e.target.value)
        }}
      />
    )
  }
  return (
    <span className="jl-date jl-date-interactive" title={iso} onClick={() => setEditing(true)}>
      {formatDate(iso)}
    </span>
  )
}
```

Thread `onDateChange` from page/card level. Compute the appropriate mutation in
the callback (unified diff for markdown files, JSON Patch for card strings).

---

## 12. Future: visual consistency with tiptap

1. Tiptap node views apply the same `jl-*` CSS classes.
2. Reset tiptap container: `.ProseMirror { padding: 0; margin: 0; }` and
   `.ProseMirror:focus { outline: none; }`.
3. Swap, don't layer: unmount `MarkdownRenderer`, mount tiptap in its place.
4. One tiptap instance at a time: only the actively edited field has an
   instance; all others remain as `MarkdownRenderer`.
