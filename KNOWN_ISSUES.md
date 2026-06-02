# Known issues

Bugs and limitations we know about and are not actively fixing. Items
here are indefinitely deferred — distinct from `next_steps.md`, which
tracks upcoming work.

## Web app

- **Firefox Android standalone PWA: back navigation from main shows a
  blank page.** A second back exits the app. Chrome Android standalone
  is the supported install path on Android; develop and test against
  Chrome.

- **FileBrowser `load()` stale closure.** The `load` function inside
  `useEffect(fn, [])` references `status` and `initData` from the
  initial render's closure. If the component somehow re-rendered before
  the effect resolved, these would be stale. In practice `useEffect`
  with `[]` runs once after mount and `status`/`initData` are set
  synchronously, so this is very low risk.

- **FileBrowser tree can lag after a sync-on-focus.** When the app
  foregrounds, sync pulls remote changes into the operation queue's
  working content and re-renders the *open file*, but the FileBrowser
  *tree* still renders from `repoCache` (items + session cache), which
  isn't refreshed from the queue on focus. So newly added / renamed /
  deleted files may not appear in the tree until the next navigation to
  main remounts FileBrowser (which refreshes against the network). Open-
  file content stays correct; only the tree listing lags. The clean fix
  is the full §6.1 render-authority flip (tree renders from `workingMap`
  too) — deferred (see `docs/mutation-sync-implementation-plan.md` Phase
  3 notes / Phase 5).

- **Module-level preload skips repo URL validation.** `_appPreload` (in
  `App.jsx`) and `_idbReady` (in `FileBrowser.jsx`) are populated at
  module-load time before the repo URL is known. After a URL change the
  app may briefly show the old assistant name in the H1 or initialise
  the tree from the wrong cache entry. Both are corrected within the
  same render batch once the init effect reads the new config. Acceptable
  trade-off for the no-flicker benefit.