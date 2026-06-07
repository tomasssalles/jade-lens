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
  - `user/short_name`:
