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

- **Module-level preload skips repo URL validation.** `_appPreload` (in
  `App.jsx`) and `_idbReady` (in `FileBrowser.jsx`) are populated at
  module-load time before the repo URL is known. After a URL change the
  app may briefly show the old assistant name in the H1 or initialise
  the tree from the wrong cache entry. Both are corrected within the
  same render batch once the init effect reads the new config. Acceptable
  trade-off for the no-flicker benefit.