# Web app

The React + Vite browser app (a PWA on Android) — the canonical viewer of the
data, and a manual editor for a growing subset of operations. It's the floor: when
the bot is unavailable or wrong, the user takes the wheel.

Source of truth: [web/src/](../../web/src/). Related:
[mutation-pipeline.md](mutation-pipeline.md) (UI edits feed the same pipeline),
[data-model.md](data-model.md) (what's rendered), [sync-and-conflicts.md](sync-and-conflicts.md)
(the sync layer + stash), [bot-interaction.md](bot-interaction.md) (the planned
in-app chat), [cost.md](cost.md) (the planned ledger).

More detail in the companion docs under [`web/`](web/): the
[architecture overview](web/architecture.md), the [editing UX](web/editing.md),
the [JSON card viewer](web/json-viewer.md), and markdown rendering
([design](web/markdown-rendering.md) / [spec](web/markdown-rendering-spec.md)).

## Guiding principle: the UI follows the data, not use-cases

Because the data structure is the bot's responsibility and evolves over time
([data-model.md](data-model.md)), a use-case-driven UI ("a screen for tasks, a
screen for fitness plans, …") is a losing battle — every new domain would need a
new screen. Instead the UI is **a comfortable, modern view onto the data as it is**,
roughly 1-to-1 with the underlying JSON / markdown — *but it should not feel like a
text editor with a JSON file open*. The shape is exposed; the experience isn't.

## UI edits feed the same pipeline as bot edits

Every UI mutation produces the same five-op artefacts the bot produces and flows
through the **same pipeline** ([mutation-pipeline.md](mutation-pipeline.md)) —
verification, apply, one log entry + one commit (message written by the runtime,
e.g. `Manual edit: toggled checkbox — projects/leasing.md`), queue for sync. So UI
edits are indistinguishable from bot edits at the data layer: one code path, one
audit substrate.

Edits batch into pipeline calls in **three tiers**, each tied to a UX mode so the
user never manages "batching" or "committing":

- **Micro-edits → immediate commit** *(built)*. One self-contained interaction
  (checkbox toggle, value pick/edit) → one op → one commit, no save button. Built
  in [web/src/JsonCardViewer.jsx](../../web/src/JsonCardViewer.jsx): an edit-mode
  lock gates editing; per-field pencils open type-specific editors. Value editors
  exist for **boolean, number, date/datetime, and wikilink**; **time-only and
  plain-string** editing are pending ([the backlog](../planning/backlog.md)).
  Markdown task-checkbox toggling is built in
  [web/src/MarkdownRenderer.jsx](../../web/src/MarkdownRenderer.jsx).
- **Text editing → batched by session** *(planned)*. Editing a markdown file or a
  JSON string field, committing the whole session on save / in-app navigation,
  discarding on cancel, with a local draft surviving an OS kill.
- **Structured creation → batched by form** *(planned)*. A schema-backed form
  (calendar event, etc.) commits a whole record on submit — blocked on the schema
  registry ([data-model.md](data-model.md)).

Open-ended user-managed batches (open a batch, edit across files, submit later)
were considered and **rejected** — they burden the user with pending state and
interact badly with the bot's commits on another device.

## Navigation *(file tree built; index-driven planned)*

Today navigation is a raw **file tree** ([web/src/FileBrowser.jsx](../../web/src/FileBrowser.jsx),
[web/src/FileTree.jsx](../../web/src/FileTree.jsx)). The intended design uses the
bot's index ([data-model.md](data-model.md)) as the table-of-contents — primary
files grouped by the index's groupings, records expandable, sidecar wikilinks
followable — with a search / filter affordance for when navigation isn't fast
enough. Both index-driven navigation and search are planned
([the backlog](../planning/backlog.md)).

## Default rendering vs. promoted views

- **Default view** *(built)* — for any JSON file, a **typed-structured** render:
  date-shaped fields as dates, sidecar references as inline-followable links, arrays
  as lists, etc. The shape maps 1-1 to JSON; the experience is "browsing structured
  records," not staring at JSON. Built as the card viewer
  ([web/src/JsonCardViewer.jsx](../../web/src/JsonCardViewer.jsx)); markdown renders
  formatted ([web/src/MarkdownRenderer.jsx](../../web/src/MarkdownRenderer.jsx)).
  Datetimes are shown in **their own zone, never converted** (see the date value
  editor — naive = local; a small `UTC`/`±hh:mm` suffix marks non-local zoned
  values).
- **Promoted views** *(planned)* — a small fixed set (calendar grid, kanban, table,
  timeline) selected per-file via the index `view:` annotation, honored from a
  fixed **view registry** that is also the schema registry ([data-model.md](data-model.md)).
  The UI doesn't sniff data shapes — the bot tells it via the annotation. None are
  built yet. The same registry is reused by future rich-payload chat responses.

## Other UI responsibilities

- **Chat input** as the primary interaction surface *(planned — the in-app bot is
  not built; [bot-interaction.md](bot-interaction.md))*.
- **Sync status + the conflict stash** *(built)* — non-intrusive indicators; the
  stash review UI is [web/src/StashView.jsx](../../web/src/StashView.jsx), with a
  pending-changes indicator in [web/src/MainView.jsx](../../web/src/MainView.jsx).
- **Cost ledger totals + threshold state** *(planned — [cost.md](cost.md))*.
- **Patch-verification failures** shown clearly with a manual-resolve option.
- **Settings** *(partly built)* — repo URL + PAT configuration and viewer-display
  settings exist ([web/src/SettingsForm.jsx](../../web/src/SettingsForm.jsx),
  [web/src/Settings.jsx](../../web/src/Settings.jsx)); vendor / model / key
  configuration is planned with the in-app bot.

## User-chosen assistant name

The assistant's display name comes from `.jade/config.json` (`assistant.name`,
set by `jadelens init`) and is shown in the app (the heading in
[web/src/MainView.jsx](../../web/src/MainView.jsx)). It's cosmetic — purely
personal preference, no role in the bot's behaviour. A dedicated in-app control to
change it (rather than editing the config) is optional polish.
