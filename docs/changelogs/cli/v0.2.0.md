# Unreleased

## Changes

- `create_file` op now accepts optional `indexed` (bool, default `false`) and
  `scope` (`string | null`, default `null`) fields. Valid combinations:
  `indexed=true` with a non-empty `scope` (primary file, auto-indexed), or
  `indexed=false, scope=null` (non-primary file, no index entry). Other
  combinations are rejected with `CREATE_FILE_BAD_INDEXED_SCOPE`.
- When `indexed=true`, the runtime automatically appends
  `{"File": "[[<path>]]", "Scope": "<scope>"}` to `Index.json` (creating it
  if absent) as part of the same atomic batch. The skill must never manually
  add index entries for `create_file` ops.
- Skill template updated: `create_file` always passes `indexed` and `scope`;
  primary files use `indexed=true` with a meaningful scope; non-primary files
  use `indexed=false, scope=null`.
