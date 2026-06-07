# JADE LENS — web app

The read-only web viewer for a JADE LENS data repo. A static React + Vite SPA,
deployed to GitHub Pages (base path `/jade-lens/`). It reads a GitHub data repo
via the GitHub API and renders its JSON + markdown files. See the top-level
`DESIGN.md` (§3, §9) for the product vision; the current build is read-only
(no chat, no mutation — those are future work).

## Commands

Run from this `web/` directory:

| Command | What |
|---|---|
| `npm install` | Install dependencies. |
| `npm run dev` | Vite dev server. |
| `npm run build` | Production build into `dist/`. |
| `npm run lint` | ESLint (must be clean). |
| `npm test` | Vitest, single run. |
| `npm run test:watch` | Vitest in watch mode. |

## Architecture

```
main.jsx → App.jsx                 routing (page state + history), top-level handlers
  ├─ Main.jsx                      assistant name + gear + file browser
  │   └─ FileBrowser.jsx           load/refresh repo, render the tree
  │       └─ FileTree.jsx          recursive collapsible directory tree
  ├─ FileView.jsx                  dispatch by extension → card viewer / markdown / text
  │   ├─ JsonCardViewer.jsx        recursive "everything is cards" JSON renderer
  │   ├─ MarkdownRenderer.jsx      react-markdown + wikilink/date plugins + highlighting
  │   └─ FileBreadcrumb.jsx        shared file-path header
  ├─ Settings.jsx / SettingsForm.jsx   repo URL + PAT, viewer-tuning sliders
  └─ FileView (text fallback)
```

### Data flow & caching (`repoCache.js`)

`repoCache.js` is the single source of truth for cached repo data. There are
three layers, fastest to slowest:

1. **In-memory session cache** — survives in-app navigation, lost on reload.
   Backs `getContentFromCache(path)` used for instant wikilink/file opens.
2. **IndexedDB** (`db.js`) — survives reloads. A one-time **module-load preload**
   (`preloadPromise` / `getPreloadedRepo()`) kicks off the IDB read at import
   time so the first render can show cached data with no "Loading…" flash.
3. **GitHub API** (`github.js`) — the network. On an IDB cache hit, a
   **background refresh** diffs the tree by blob SHA and re-fetches only
   changed/added blobs (capped at `BLOB_FETCH_CONCURRENCY` requests in flight).

A cached repo record is
`{ repoUrl, branch, items, contentMap: Map<path,string>, truncated, jadeConfig }`.
`parseJadeConfig` pulls `.jade/config.json` out of the content map (drives the
assistant name shown in the header).

### Rendering

Every string value — standalone `.md` file or inline JSON string — goes through
the same `MarkdownRenderer`. Custom remark plugins turn `[[wikilinks]]` and ISO
dates into interactive nodes; `rehype-highlight` colours fenced code blocks.
See `docs/web/markdown-rendering.md` and `docs/web/json-viewer.md` (repo root)
for the design rationale, and `docs/web/markdown-rendering-spec.md` for details.

### Viewer settings (`viewerSettings.js`)

All visual tuning (colour palette, spacing, typography, breakpoints) lives in
one settings object persisted to IndexedDB, exposed via the Advanced settings
panel. Colours are HSL-derived from a base hue/saturation and delivered to CSS
as custom properties via `applySettingsCssVars`.

## Tests

Pure modules are unit-tested with Vitest (`*.test.js` next to their sources):
`pathUtils`, `github` (URL parsing + base64 decode), `viewerSettings` (colour
math), and the remark plugins. The cache/component layers are not yet covered.
