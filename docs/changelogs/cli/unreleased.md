# Unreleased

## Fixed

- `jadelens check` / `jadelens apply` no longer raise `INDEX_MISSING_ENTRY` for
  files whose names contain non-ASCII characters (e.g. an em dash). The
  enforcement pass listed files via `git ls-files`, which octal-quotes and
  double-quotes non-ASCII paths by default, so they never matched the Unicode
  paths in `Index.json`. File listing now uses NUL-delimited output (`-z`),
  matching the convention already used in `sync.py`. The same fix repairs
  wikilink scanning/rewriting (`_scannable_files`), which had been silently
  skipping such files.
