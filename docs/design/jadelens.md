# JADE LENS — design overview

A personal AI assistant for daily life. (Long-form: *Jenuinely Adaptive,
riDiculously vErsatiLE iNtellect Sidekick*. Nevermind the typo, it's a joke.)

This is the high-level design doc — the map of the system and the entry point
into the focused design docs under `docs/design/`. It describes **intended
design**; some of it is built, some is still planned. Where a subsystem doc
exists, it is the authority for that subsystem; this doc stays at the altitude of
"what the whole thing is and why."

---

## 1. What it is

JADE LENS is a **single-user assistant**, used all day, that helps organise,
track, visualise, plan, and research everything life throws up — appointments,
to-dos, projects, research dossiers, fitness plans, brainstorms, preferences,
whatever accrues over time.

**Interaction model:**

- **The bot is the primary input surface.** The user speaks chaotic, non-linear
  natural language; the bot interprets it and decides where and how to store the
  information.
- **The bot designs the data structure itself** — files, schemas, organisation.
  JADE LENS ships with *no* predetermined data model; the structure evolves with
  use over months and years.
- **The UI is the canonical viewer**, and supports manual edits for a meaningful
  subset of operations. It's the floor: when the bot is unavailable or wrong, the
  user takes the wheel.
- **The bot delivers insight** — natural-language queries, filters, and
  statistics over the data.
- **Multi-turn chat is first-class.** Some interactions are whole conversations
  that settle into a data change only after several rounds — or end with none.

*Worked example:* told in random order over a day about five work tasks, a hobby
project, a kid pickup, a haircut, and a dentist appointment to book this month,
JADE LENS can produce the next morning's sensible to-do plan — weighing
priorities and deadlines, fixed calendar events, stated preferences (working
hours, break cadence), rough duration estimates, and spreading load across days.

**Goals beyond the primary one:**

- *Secondary — human-readable, human-editable data.* Mistakes are expected early;
  inspectable files make debugging and manual correction feasible. This drives
  the JSON + markdown format choice.
- *Tertiary — a full audit trail.* Every atomic data change is one git commit +
  one operations-log entry (see `audit-and-correction.md`).

---

## 2. Constraints

Three hard constraints shape every choice:

1. **$0 hosting.** No paid hosting for code, the "binary", or the data.
   GitHub-based hosting is the default path.
2. **Near-zero recurring AI cost** above the existing Claude Pro subscription. The
   user will try the API but won't tolerate runaway costs; any API-dependent
   design must be cheap from day one and validated against real volumes.
3. **AI-assisted interaction at the core** — JADE LENS's reason for existing.
   Using *Claude specifically* isn't strict; multi-vendor support is a wish (see
   `bot-interaction.md`).

---

## 3. Platforms and architecture

Runs on **Linux desktop** (primary), **macOS desktop**, and **Android** mobile.
iOS is out of scope.

**High-level shape** — a static web app (**React + Vite**) hosted on **GitHub
Pages**; no server-side code we operate. Data lives in a GitHub repository,
accessed via the GitHub API on mobile and git or the API on desktop.

```
Browser (any device)
    ↓
Static SPA  (React + Vite, served from GitHub Pages)
    ↓
Local data layer  (IndexedDB)
    ↓
Sync adapter  ←→  GitHub repo (the data repo)
    ↓
Bot adapter  ←→  Anthropic API  (+ others as multi-vendor matures)
```

On **desktop with Claude Code**, the user can additionally drive JADE LENS via a
`/<assistant>` slash command (default `/jade`) operating on a local clone — a
separate code path from the web app (see `claude-code-integration.md`).

**Two repositories:**

| Repo | Holds | Visibility |
|---|---|---|
| **Code repo** (this one) | The web app, the skill, the Python tooling, migrations, docs | Public-capable |
| **Data repo** | The user's JSON + markdown data only — no code | Private |

The web app and the skill take the data-repo location as a per-install setting.
A hypothetical public future gives every user their own private data repo and
points the app at it — no multi-tenant backend.

**Local-first.** The UI reads and writes only local state; it never blocks on the
network. Sync is a background concern that emits events the UI subscribes to.

**No mobile-native daemons.** Termux + git + Claude Code on Android was
considered and killed (battery, OS-resistance). On mobile the only paths are the
GitHub API and a bot API — no persistent background processes.

---

## 4. Guiding principles (compressed)

- **The bot designs the data structure.** Files, schemas, organisation evolve
  with use; no upfront schema design.
- **Files (JSON + markdown) are the source of truth.** Human-readable,
  LLM-friendly, version-controllable.
- **Local-first.** The UI never blocks on the network; remote sync is background.
- **Audit by git commits + an operations log; correction goes forward.** The bot
  writes commit messages; the runtime appends one ops-only log entry per atomic
  change. Mistakes are fixed by telling the bot — history doesn't rewind.
- **Cost-aware by design.** Output-token frugality drives patch format, cache
  structure, model selection, and discovery flow.
- **AI substrate is open and pluggable at low cost** — multi-vendor optionality
  preserved, but not paid for heavily.
- **No information loss.** Conflict resolution may be manual or inconvenient, but
  never silently drops user-provided data.

---

## 5. The design docs

The focused docs under `docs/design/` (linked as each is migrated):

- **[Data model](data-model.md)** — file types, the index, preferences, schemas &
  the view registry, the database option.
- **[Mutation pipeline](mutation-pipeline.md)** — the five-op change format,
  validation, atomicity, the shared web+CLI pipeline, and cross-client
  byte-identity (the conformance suite).
- **[Wikilinks](wikilinks.md)** — the `[[path]]` reference convention and its
  rename/delete mechanics.
- **[Inline-vs-sidecar promotion](inline-sidecar-promotion.md)** — auto-migrating
  large inline strings to `.md` sidecars *(planned)*.
- **[Bot interaction](bot-interaction.md)** — the bot's role, the discovery flow,
  prompt-cache structure, multi-vendor support.
- **[Audit and correction](audit-and-correction.md)** — the atomic-change unit,
  the operations log, forward-only correction.
- **Sync and conflicts** — local-first sync, conflict detection, the stash.
- **Web app** — UI principles, UI edits feeding the pipeline, navigation,
  rendering and promoted views, value editors.
- **Calendar** — external calendars as an augmentation / lazy-JSON source.
- **Claude Code integration** — the skill, the `jadelens` CLI mutation tool, and
  data-repo bootstrap (`jadelens init`).
- **Cost** — the cost ledger and token-cost as a design metric.
- **Versioning** — three independent version tracks and the migration system.
- **Security and trust** — credential storage, hosting, encryption, auth.

> **Migration in progress.** These docs are being split out of
> `legacy-docs/DESIGN.md`; until each lands, its content still lives there. See
> `docs/planning/design-migration.md` for status.

## 6. Scope and status

What ships when is tracked in the changelogs (`docs/changelogs/`) and the backlog
(`docs/planning/backlog.md`), not here. The design docs describe intended
behaviour and may run ahead of the code — they flag what is built vs. planned in
context. The immediate milestone has been a narrow, `/jade`-first envelope aimed
at validating the bot's data-organisation thesis with minimal infrastructure; the
web app and the broader pipeline are built out from there.
