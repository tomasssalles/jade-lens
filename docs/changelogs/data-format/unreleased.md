# Data format for the first release of JADE LENS

## Data repo and required files

- The data is stored in a git repository. Real files and directories.
- The user's personal content is stored in JSON (`.json`) and markdown files (`.md`). No other formats or extensions are allowed.
- Links to other data-repo (personal content) files are formatted as wikilinks, i.e. `[[path/relative/to/repo/root]]`, both in JSON string values and in markdown files. URLs and same-file section-links (markdown) are formatted the usual way (bare URLs or `[label](reference)`).
- At the repo root there's an index file called `Index.json` (capitalized). It is an array with one entry for each file that the bot considers _primary_ (i.e. should be immediately discoverable, hence the entry in the index). The data may include other (unindexed) files which are reached indirectly via links, starting from primary ones. Each index entry is of the form

```json
{
  "File": "[[path/relative/to/repo/root]]",
  "Scope": "Description of what the file is for, what belongs/doesn't belong there."
}
```

- Files used by the tooling (instead of directly by the bot) are stored inside the repo in `.jade/`
- There's a config file at `.jade/config.json`, containing the fields:
  - `user/full_name`: The user's full name, used by the bot in more formal contexts.
  - `user/short_name`: A short name or nickname, used by the bot in informal contexts.
  - `assistant/name`: The name the user chose for the assistant (and its `/<name>` skill command).
- The data format version is recorded in `.jade/version` (`v1` for this release). Both the CLI and the web app declare the version they support and check the repo against it.
- The operations log lives at `.jade/operations-log/<version>.jsonl` (e.g. `v1.jsonl`): an append-only file with one line per atomic data change, recording its timestamp, commit message, and the operations applied. One file per data format version; older files are kept as history after a migration.
- Conflict-stashed changes live under `.jade/stash/`: one file per batch that lost a sync race, kept until the user resolves it.
- Everything under `.jade/` is tooling-managed and off-limits to the bot. More generally, the bot may not write to dot-prefixed top-level paths (`.jade/`, `.claude/`, `.git/`, `.gitignore`, …) — they're reserved for tooling.
