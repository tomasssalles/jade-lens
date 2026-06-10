# Unreleased

## Changes

- File tree is now driven by `Index.json` instead of the raw git tree. Only
  files listed in the index are shown; `Index.json` itself is excluded. Falls
  back to the filtered git tree when no `Index.json` is present.
- Removed the special pinned-and-emphasized display of `Index.json` at the top
  of the file tree.
