# Unreleased

## Changes

- File tree is now driven by `Index.json` instead of the raw git tree. Only
  files listed in the index are shown; `Index.json` itself is excluded. Shows
  an empty tree when `Index.json` is absent — no fallback to the raw git tree.
- Removed the special pinned-and-emphasized display of `Index.json` at the top
  of the file tree.
