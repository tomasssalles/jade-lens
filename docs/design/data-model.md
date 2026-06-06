# Data model

How the user's data is shaped and organised. The headline principle: **the bot
designs the structure** — file shapes, schemas, organisation all evolve with use.
JADE LENS ships with no predetermined data model. What follows is the small set of
*conventions* that structure lives inside.

Related: [mutation-pipeline.md](mutation-pipeline.md) (how the data changes), [wikilinks.md](wikilinks.md) (how files
reference each other), [inline-sidecar-promotion.md](inline-sidecar-promotion.md) (planned), [web-app.md](web-app.md) (how
the data is rendered).

## File types

Two file types live in the data repo:

- **JSON files** carry all structured data — records, schemas, the index,
  configuration.
- **Markdown files** carry prose — long-form notes, drafts, research write-ups,
  brainstorms.

These are separate files. Prose can also live **inline** as a JSON string value
when small; the (planned) promotion rule decides which case applies — see
[inline-sidecar-promotion.md](inline-sidecar-promotion.md).

## The index file (`Index.json`)

A JSON file at the data-repo **root**, maintained by the bot, describing which
**primary JSON files** exist and what each holds. It's the bot's map of the data:
it lets the bot pick which files to read without scanning everything, and it
doubles as the web app's navigation structure (see [web-app.md](web-app.md)).

It lives at the root rather than under `.jade/` because the bot is its writer and
the bot can't touch protected dot-paths ([mutation-pipeline.md](mutation-pipeline.md)). The capitalised
`Index.json` follows the human-readable naming convention applied to all primary
files. `jadelens init` scaffolds it as an empty array ([jadelens/cli.py](../../jadelens/cli.py)); the bot
grows it from there.

### Format

`Index.json` is a JSON **array**; each element is an object with at minimum:

- **`"File"`** — a wikilink to the primary file, e.g. `"[[Projects/Citizenship.json]]"`.
- **`"Scope"`** — a short description of what the file holds.

```json
[
  {"File": "[[Projects/Citizenship.json]]", "Scope": "Applications, documents, and deadlines for the citizenship process"},
  {"File": "[[Calendar/Events.json]]", "Scope": "Calendar events", "view": "calendar", "alwaysLoad": true}
]
```

It deliberately contains **no** field that mutates on every data write (line
counts, timestamps): the index is reloaded every bot interaction and is a prime
prompt-cache anchor ([bot-interaction.md](bot-interaction.md)), so a churning field would destroy
cache fitness. Sidecar `.md` files get **no** index entry — they're discoverable
through the wikilink that points at them.

### Annotations

Entries can carry annotations alongside `File`/`Scope`:

- **`"alwaysLoad": true`** — the runtime includes this file (and its sidecars) in
  every interaction's prompt, at a stable cache-friendly position. This is how
  preferences and similar always-needed context stay loaded and cached. The bot
  maintains it: when it spots context-essential input ("I work out in the
  mornings"), it writes the data *and* marks the destination always-load.
- **`"view": "<type>"`** — selects a promoted UI view (calendar / kanban / table /
  timeline) from the view registry (see [web-app.md](web-app.md) and "Schemas & the view
  registry" below).
- **`"lazyLoadSidecars": true`** *(tentative)* — for the unusual JSON file with
  many large, rarely-needed sidecars: skip eager sidecar loading for it. Default
  is eager ([bot-interaction.md](bot-interaction.md)).

## Preferences

The user's preferences (working hours, break cadence, exercise habits, dietary
notes, communication style) are treated as **normal data**: the bot decides where
to store them, retrieves them when needed, and writes new ones as stated. The only
special handling is `alwaysLoad` on the destination file, so they're cached and
visible every interaction. No `preferences.*` file convention is enforced; the bot
may adopt one if it likes.

## Schemas and the view registry are the same set *(intended, not built)*

The bot's structural autonomy is **constrained inside a small, fixed registry of
"first-class" types**. The registry is the same set of types that have specialised
UI views:

| Type | Schema (data shape) | View (UI affordance) |
|---|---|---|
| `calendar` | Event records (title, time, location, attendees, recurrence, …) | Calendar grid |
| `kanban` | Card records (title, column, ordering, metadata) | Kanban board |
| `table` | Tabular records with a defined column schema | Table view |
| `timeline` | Time-ordered records | Timeline view |
| … | … | … |

- **First-class type → schema + view, registered together.** Adding a specialised
  type is one decision (schema + view), not two.
- **Anything outside the registry** is bot-designed freeform data, rendered by the
  default typed-structured viewer ([web-app.md](web-app.md)) with no schema enforcement.
- **Start small.** Pick one or two registered types (calendar is the obvious
  first, given [calendar.md](calendar.md)); add more only when real usage shows both the data
  shape and the UI benefit.
- **Schema evolution** — adding or changing a registered type — is handled by the
  migration system ([versioning.md](versioning.md)).

Exact registry contents are TBD and grow over time; the principle above is the
union. None of this is implemented yet.

## Database option *(intended, not built; working assumption for v1: no DB)*

For some shapes — notably to-dos with rich queryability (area, priority,
deadlines, blockers) — a structured database could beat JSON files on query speed
and bulk updates. If adopted, it uses the **lazy-JSON** pattern so the bot's
interface stays uniform (JSON in, JSON Patch out):

1. User prompt → bot derives query parameters.
2. Runtime queries the DB.
3. Result rows are projected to an in-memory JSON view.
4. The JSON view is shown to the bot.
5. Bot emits a JSON Patch.
6. The patch is translated back into DB updates.

| | Pros | Cons |
|---|---|---|
| **DB-backed (lazy JSON)** | Fast queries & bulk updates, native indexing | Harder to inspect manually; third-party signup; lock-in |
| **JSON-file-only** | Simple, fully inspectable, single substrate | Linear scan to query; large all-tasks file as it grows |

The same lazy-JSON pattern is how external calendars plug in ([calendar.md](calendar.md)), and
the longer-term Supabase substrate option is discussed in [versioning.md](versioning.md) /
[security-and-trust.md](security-and-trust.md). Whether to adopt a DB in v1 is open; the working
assumption is no DB.
