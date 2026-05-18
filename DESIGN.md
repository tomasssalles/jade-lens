# JADE LENS — Design Document

A personal AI assistant for daily life. (Long-form: *Jenuinely adaptive, ridiculously versatile intellect sidekick*.)

---

## 1. Purpose and Behaviour

JADE LENS is a **single-user assistant**, used all day every day, that helps organise, track, visualise, plan, and research everything that comes up in life — calendar appointments, to-do lists, projects (work and hobby), research dossiers (e.g. comparing cars for a leasing decision), fitness programmes, brainstorming notes, presentations, preferences, and whatever else arises over time.

### Interaction model

- **The bot is the primary input surface.** The user speaks chaotic, non-linear natural language. The bot interprets it, decides where and how to store the information, and updates the data accordingly.
- **The UI is the canonical viewer**, and also supports manual data updates for a significant subset of operations. The UI is the floor: when the bot is unavailable or making mistakes, the user takes the wheel.
- **The bot delivers insight** — natural-language queries, filters, and statistics on the data — alongside the standard visualisations the UI provides.
- **The bot designs the data structure itself.** Files, schemas, organisation, and the structure of records inside files are the bot's responsibility. JADE LENS does not ship with a predetermined data model; the structure evolves with use over months and years, as the kinds of information the user stores become clearer.
- **Multi-turn chat is first-class.** Some interactions are full conversations about a project that settle into a data change only after several rounds of dialogue. Some sessions may consist entirely of discussion and end without any data change.

### Worked example

The user tells JADE LENS, in random order over the course of a day, about five work tasks for the week, a hobby project they'd love to start, when to pick up the kids, a haircut appointment, and that a dentist appointment needs to be made this month. When asked the next morning for today's to-do list, JADE LENS produces a sensible plan, taking into account:

- Task priority and absolute / relative deadlines.
- Fixed calendar events (the kid pickup, the haircut).
- Stated personal preferences (preferred working hours, workout times, the rule that breaks happen every 30 minutes of focused work).
- Rough duration estimates for each task based on its description.
- Spreading workload across multiple days when many things need doing within a week.

The to-do list is one example. The same reasoning applies to whatever domain the user works in: research, fitness, planning, personal admin.

### Secondary and tertiary goals

- **Secondary: human-readable, human-editable data.** Mistakes are expected early on — both bot mistakes and unclear user prompts. Inspectable files make debugging and manual correction feasible. This shapes the data-format choices (JSON + markdown) but is not a primary driver.
- **Tertiary: full audit trail of interactions and data changes.** Useful for debugging, conflict resolution, and *replay-based correction* when a mistake is only noticed after later interactions have built on top of it (§7).

---

## 2. Constraints

Three hard constraints shape every design choice:

1. **$0 hosting.** No paid hosting for code, the "binary," or the data. GitHub-based hosting is the default path. Other zero-cost approaches are welcome where they fit better.
2. **Near-zero recurring AI costs above the existing Claude Pro subscription.** The user is willing to try the API but won't tolerate runaway costs. Any API-dependent design must be cheap from day one and validated against real volumes before commitment.
3. **AI-assisted interaction at the core.** This is JADE LENS's reason for existing. Using *Claude specifically* is not strict; multi-vendor support is a design wish (see §11).

---

## 3. Platforms and Architecture

JADE LENS runs on:

- **Linux desktop** (primary development and use)
- **macOS desktop**
- **Android mobile** (Fairphone 4 class)

iOS is not in scope.

### High-level shape

A static web app, built with **React + Vite**, hosted on **GitHub Pages**. No server-side code we run. Data lives in a GitHub repository, accessed via the GitHub API on mobile and either git or the GitHub API on desktop.

```
Browser (any device)
    ↓
Static SPA  (React + Vite, served from GitHub Pages)
    ↓
Local data layer  (IndexedDB, or local filesystem where available)
    ↓
Sync adapter  ←→  GitHub repo
    │           ( ←→  Supabase or similar, if/when a DB is adopted for some data — §4.7 )
    ↓
Bot adapter  ←→  Anthropic API
              ( + Gemini, OpenAI as multi-vendor matures — §11 )
```

On **desktop with Claude Code installed**, the user can additionally invoke JADE LENS through a `/jade` slash command in the Claude Code TUI (§12). That path operates on a local clone of the data and is a separate code path from the web app.

### Repository structure

JADE LENS lives in **two separate repositories**:

| Repo | Holds | Visibility |
|---|---|---|
| **Code repo** (this one — `jade-lens`) | The web app, the `/jade` Claude Code skill, supporting scripts (probably Python), migration scripts (§14), documentation | Public-capable; may eventually become an app others can use |
| **Data repo** | JSON + markdown data files only — no code. The bot reads from and writes to this repo. | Private (the user's personal data) |

The web app and `/jade` skill take the data-repo location as a per-install setting (and/or env var). In a hypothetical future public scenario, every user gets their own private data repo and points the app at it — no multi-tenant backend required.

The "GitHub repo" in the diagram above is the **data** repo. The web app is *served from* the code repo's GitHub Pages deployment but *reads and writes* the data repo at runtime.

### Local-first principle

The UI reads and writes only **local state**. It never blocks on the network. Sync to the remote store is a separate, background concern that emits events the UI subscribes to.

### No mobile-native daemons

Running Termux + git + Claude Code on Android was considered and explicitly killed. Battery and OS-resistance costs are too high. **On mobile, the only paths are the GitHub API and a bot API.** No persistent background processes.

---

## 4. Data Model

### 4.1 File types

Two file types live in the data repository:

- **JSON files** carry all structured data — records, schemas, the index, configuration.
- **Markdown files** carry prose content — long-form notes, presentation drafts, research write-ups, brainstorms.

These are *separate files*. Prose can also live **inline** as a JSON string value when small; the promotion rule (§4.3) decides which case applies.

### 4.2 Change format

The bot emits compact, machine-applicable changes:

- **JSON Patch (RFC 6902)** for JSON files.
- **Unified diff** for markdown files, with **0 context lines** as the default to minimise output tokens.

For unified diffs, the runtime verifies that the line at the claimed line number matches the claimed old content before applying. Failed verifications surface to the user for manual intervention and signal that the bot made a mistake worth investigating.

### 4.3 Inline-vs-sidecar promotion (programmatic)

Prose lives inline as a JSON string when small. When it grows or becomes markdown-structured, the runtime migrates it to a separate `.md` file and replaces the JSON value with a path reference. **This migration is handled by the runtime, not by the bot.**

**Rule.** When the bot emits a JSON Patch `add` or `replace` on a string value, the runtime computes the resulting value and checks:

- Line count ≥ 3, **or**
- Structural markdown markers present (headings, list bullets, fenced code blocks, multi-paragraph).

If either trigger fires, the runtime:

1. Writes the content to a new `.md` file at a derived path.
2. Rewrites the JSON Patch so the value is a path reference (e.g. `notes` → `notesPath: "projects/leasing/notes.md"`).
3. Applies the rewritten patch.

**Hysteresis on demotion.** A sidecar `.md` file that *shrinks* back to 1-2 lines stays a file. No demotion. Prevents oscillation at the boundary.

**Scope.** This applies only to JSON Patch ops on inline string values. Unified-diff updates to existing `.md` files are pass-through — the bot already sees a `*Path` reference (not an inline string) and writes a diff directly.

**Why programmatic, not bot-driven.**

- The bot saves output tokens — one patch op per write, not two ops plus a file-create wrapper.
- Deterministic — the same content gets routed the same way every time, independent of bot mood or vendor.
- Removes prediction burden from the bot.

**Bot-facing instruction** (to include in the system prompt):

> Some prose content lives inline as JSON string values, and some lives in separate `.md` files referenced by path. You'll see which is which from the data. When adding or modifying inline string values, emit JSON Patch normally — don't worry about size. If a string grows large or becomes markdown-structured, the program will migrate it to a separate `.md` file automatically and replace the JSON value with a path reference. Respect that — don't migrate the content back into the JSON.

### 4.4 Sidecar filenames

Three conventions considered:

| Convention | Pros | Cons |
|---|---|---|
| **Hash names** | Stable, deterministic, never collide | Opaque; uninformative for both bot and human |
| **JSON-path + key-path** (e.g. `projects/leasing__comparisons__notes.md`) | Highly informative | Renaming the parent JSON or key requires sidecar rename to stay aligned |
| **Sidecar directory per JSON** (e.g. `projects/leasing.json` paired with `projects/leasing/<key-path>.md`) | Sidecars travel with their parent JSON as a unit; in-directory names stay readable | Slightly deeper directory nesting |

*Leaning toward the sidecar-directory approach* — cleanest refactor story, still informative. Not locked; revisit at implementation time.

### 4.5 The index file

A JSON file (e.g. `.jadelens/index.json`) maintained by the bot, describing which **primary JSON files** exist and conceptually what each holds. The index is the bot's map of the data; it lets the bot pick which files to read without scanning everything.

#### Contents

For each primary JSON file: filename, brief conceptual description, optional grouping, optional behavioural annotations.

The index does **not** contain:
- Line counts.
- Last-modified timestamps.
- Any other field that changes on every data write.

**Rationale.** The index is reloaded on every bot interaction and is a prime candidate for prompt caching. Any field that mutates with normal data activity destroys cache fitness.

**Sidecar `.md` files do not need their own index entries** — they are discoverable through the JSON references that point to them.

#### `alwaysLoad` annotation

Any index entry can carry `alwaysLoad: true`. The runtime includes such files in every interaction's prompt at a stable, cache-friendly position.

The bot maintains the annotation. When it identifies context-essential input ("I prefer to work out in the morning"), it writes the data normally *and* marks the destination as always-load.

This lets preferences and similar always-needed context be treated as ordinary bot-managed data while guaranteeing they are loaded and cached every interaction.

#### `lazyLoadSidecars` annotation *(tentative)*

For the unusual case of a JSON file with many large sidecars rarely needed, the index entry for that file can carry `lazyLoadSidecars: true`. The runtime then skips eager-loading the sidecars for that file. Default behaviour is eager (§6.2).

### 4.6 Preferences

The user's preferences (working hours, break cadence, exercise preferences, dietary notes, communication style — anything the bot should know about the user) are treated as **normal data**:

- The bot decides where and how to store them.
- The bot retrieves them when needed.
- The bot writes new preferences when the user states them.

The only special handling is `alwaysLoad` on the destination file — so preferences are cached and visible in every interaction.

No designated `preferences.*` file convention is enforced by the runtime. The bot may create one if it prefers consistency, but it isn't required.

### 4.7 Database option

For some data shapes — notably to-do items with rich queryability (project / area, priority / urgency, deadlines absolute and relative, blockers, etc.) — a structured database might be more efficient than JSON files for query speed and bulk updates.

If adopted, the database integration uses the **lazy JSON** pattern:

1. User prompt → bot derives query parameters.
2. Runtime queries the DB.
3. Result rows are projected to an in-memory JSON view.
4. JSON view is shown to the bot.
5. Bot emits a JSON Patch.
6. Patch is translated back into DB updates.

This way the bot's interface is uniform (always JSON in, JSON Patch out) regardless of underlying storage.

| | Pros | Cons |
|---|---|---|
| **DB-backed (lazy JSON)** | Fast queries, fast bulk updates, native indexing for filtering by date / priority / etc. | Harder to inspect manually (degrades the secondary goal); third-party signup; vendor lock-in concern |
| **JSON-file-only** | Simple, fully inspectable, single substrate | Linear scan for query; large all-tasks file when the to-do list grows |

*Whether to adopt a DB in v1 is open* (§17). Working assumption for v1: no DB.

### 4.8 Schemas and the view registry are the same set

The bot has wide autonomy in designing the data structure (§5) — file shapes, schemas, organisation. That autonomy is **constrained inside a small, fixed registry of "first-class" data types**. The registry is the same set of types that have specialised UI views (§9.4):

| Type | Schema (data shape) | View (UI affordance) |
|---|---|---|
| `calendar` | Event records (title, time, location, attendees, recurrence, …) | Calendar grid |
| `kanban` | Card records (title, column, ordering, metadata) | Kanban board |
| `table` | Tabular records with a defined column schema | Table view |
| `timeline` | Time-ordered records | Timeline view |
| … | … | … |

(Exact registry contents are TBD and will grow over time; the principle above is the union.)

- **First-class type → schema + view, registered together.** Adding a new specialised data type is one decision (schema + view), not two.
- **Anything outside the registry** is bot-designed freeform data, rendered by the default typed-structured viewer (§9.4) and with no schema enforcement.
- **For v1: start small.** Pick one or two registered types (calendar is the obvious candidate given §10). Add more only when real usage shows clear evidence the data shape and the UI both benefit.
- **Schema evolution** — adding a new registered type, or evolving an existing one — is handled by the migration system (§14).

---

## 5. Bot Interaction

### 5.1 Primary input surface

A **prominent chat input** is visible in the UI at all times. Single-shot prompts work for quick actions; the input can also expand into a full chat conversation that spans multiple turns before settling into a data change.

### 5.2 What the bot does

- **Interpret** the user's chaotic natural-language input.
- **Decide** what files, schemas, and structures should exist to hold the resulting information.
- **Write** changes as JSON Patches (for JSON files) and unified diffs (for markdown files).
- **Answer** queries, apply natural-language filters, and produce statistics.
- **Maintain the index file** so future interactions can navigate the data efficiently, including `alwaysLoad` markings on context-essential data.

### 5.3 Manual UI editing

The UI supports direct data edits without going through the bot — quick task additions, status toggles, calendar event creation, marking things done, etc. This is both the fallback when the bot is unavailable and the convenience path for trivial operations.

---

## 6. Discovery Flow (how the bot gets the data it needs)

When a query comes in, the runtime cannot programmatically determine which files the bot needs. Some discovery is required. The design tries to minimise round-trips and maximise prompt-cache reuse.

### 6.1 Sessions and prompt-cache structure

**Sessions are chat threads.** A "session" is a chat the user thinks of as one continuous thing — short most of the time (sometimes just one input + one response), with a new chat usually starting per "thing I want to tell or ask the bot." Threads persist in the interaction log and can be reopened later (though cross-chat history re-loading is deferred — §15.2).

**UI-level turn vs. API-level rounds.** A single chat turn from the user's perspective can be **multiple API rounds** the runtime handles transparently:

- *Round 1:* full prefix + user query → bot either returns the final answer (the v1 eager-load-everything path) or a structured data request (the post-v1 path).
- *Round 2 (if needed):* the prior context + bot's data request + the loaded data → bot's final answer.

The interaction log records API-level rounds (so replay-based correction (§7.2) can replay the actual back-and-forth). The UI presents a single turn.

**Prompt structure.** Each API call's prompt is layered:

```
[ system prompt ]                         ← chat-independent, rarely changes
[ index ]                                  ← chat-independent, changes occasionally
[ alwaysLoad files + their sidecars ]      ← chat-independent, changes occasionally
═══════ cache breakpoint (chat-independent) ═══════
[ this chat's history so far ]            ← chat-specific, monotonically grows within the chat
═══════ cache breakpoint (chat-specific) ═══════
[ this turn's discovery-loaded data ]     ← turn-specific
[ user query for this turn ]              ← turn-specific
```

**Cache reuse across chats.** Everything above the chat-independent breakpoint is identical across chats. A fresh chat that opens within the provider's cache TTL of any prior call (in any chat) gets a cache hit on the system + index + alwaysLoad chunk for free — that's the bulk of the prefix tokens in most cases. Caching is *not* a session-bounded concept here; the chat-independent prefix is the primary cache anchor and outlives any single chat.

**What invalidates the chat-independent cache:**

- Index changes (bot adds / removes a primary file, edits a description, flips an `alwaysLoad` annotation).
- alwaysLoad content changes (e.g. a preferences file update).
- Otherwise stable across many chats over hours / days.

**What invalidates the chat-specific cache:**

- Switching chats.
- Within a chat, new turns *extend* the cached prefix rather than invalidating it — round 2 of a multi-round turn keeps the round-1 cache hot, and the next user message after the bot's response does the same.

**Cache TTL.** Anthropic's standard ephemeral cache is 5 minutes; a 1-hour option exists at ~4× cost. The 1-hour option becomes interesting for sparse-but-not-dead usage patterns (one request, then another 20 minutes later in a different chat). Not adopted by default; revisit if the actual usage pattern justifies it.

**Cache is keyed by model.** The provider's cache is per-(model, prefix). Switching models mid-chat (e.g. Haiku → Sonnet for a harder follow-up question) invalidates the cache that had been building up; the new model starts cold. This shapes the model-right-sizing strategy — see §13.5.

### 6.2 Sidecar loading: eager by default

When a JSON file is included in the bot's context, its referenced markdown sidecars are loaded automatically with it. *Leaning toward this as the default.* Reasoning:

- Cost is bounded by the parent JSON's own references (which the bot controls implicitly).
- Cache behaviour is better: "this JSON + its sidecars" is a deterministic bundle.
- Eliminates "oh I also needed the notes" follow-up rounds.

Escape hatch: per-file `lazyLoadSidecars: true` in the index for unusual cases.

### 6.3 JSON-file selection: three candidate patterns

| Pattern | Rounds | Token cost | Notes |
|---|---|---|---|
| **Eager-load-everything** | 1 | High input | Simple, cache-friendly; doesn't scale past modest data volumes |
| **Structured data-request round** | 2 (sometimes 1) | Lower input, slight output overhead | Round 1: bot emits a list of files needed. Round 2: data is loaded, bot answers. With cache, round 2's prefix is largely reused. Portable across vendors. |
| **Tool-use-driven** (`read_file` tool) | Variable | Variable | All major vendors support function-calling, but wire formats differ. Risks iterative discovery unless the bot is instructed to batch. |

**v1 direction:** *eager-load-everything*, assuming modest data volumes early on. Transition to structured-data-request when data grows past some threshold (rough heuristic: a few hundred KB of JSON). Tool-use stays as a later option if genuinely iterative exploration earns its keep.

### 6.4 Cross-chat history

Within a chat, the chat's history is part of the chat-specific cacheable section. **Cross-chat history** — re-loading prior chat threads when continuing a multi-day project conversation — is deferred (§15.2). Each new chat starts with an empty history; the chat-independent prefix is still shared and cache-friendly.

---

## 7. Audit and Replay-Based Correction

### 7.1 The interaction log

A dedicated log records:

- Every prompt the user sent the bot.
- Every response the bot returned.
- Every manual edit the user made directly to files.
- Every manual edit the user made through the UI.

The log is separate from git history. **It is not stored in commit messages** — commit messages aren't fit for that purpose (length limits, escaping issues, two-tier awkwardness, hard to search).

Redundancy with file content (and with git diffs, if git is the sync substrate) is acceptable. On-disk size is not expected to be a limiting factor; the audit value justifies the overlap.

### 7.2 Replay-based correction

When the bot makes a mistake noticed only after subsequent interactions have built on top of it:

1. Rewind the data to its pre-mistake state.
2. Replay subsequent interactions, including a correction hint at the point of the original mistake.

**Cheap-replay pattern.** For each interaction being replayed, the bot is shown its prior input and prior response and asked:

> *Either give me a corrected response, or just answer "OK" (1 output token) if your response was already correct.*

Most replayed interactions return `OK` — replay stays inexpensive. Only the actually-affected interactions get redone.

### 7.3 Local-only data on mobile

`.git` (if present) and the interaction log are local-only state. They are not synced through to mobile devices to save space; they can be loaded on demand if needed.

---

## 8. Sync

### 8.1 Local-first

The UI never blocks on the network. Local state is the working set; sync runs in the background and emits events the UI subscribes to.

### 8.2 Triggers and surfacing

Sync triggers:
- App open.
- Tab focus-gain.
- Debounced after writes (~30s of no further edits).
- Periodic when idle (interval TBD).
- Manual "Sync now" button.

A non-intrusive status indicator shows the current sync state (last-synced timestamp, in-progress, error).

Conflicts surface **non-modally**. In the common case (local is an ancestor of remote), a quiet fast-forward is enough.

### 8.3 Remote storage substrate (open)

Three candidates have been weighed:

| Substrate | What lives there | Pros | Cons |
|---|---|---|---|
| **GitHub repo of state files** | Current-state JSON and markdown files; mutations are commits | $0, auth already exists, version control free, raw files inspectable on github.com | Pull/push latency; GitHub API quotas (fine for personal); conflict resolution at git's text level unless we add a semantic merge layer |
| **GitHub repo with fine-grained commits as a de-facto patch log** | Same files; one commit per bot action, commit message holds the raw prompt | Most patch-log benefits (audit, prompt-attached-to-change, append-only history) without a new schema | Same latency / quota tradeoffs; commit messages become semantically loaded |
| **Firebase / Supabase free-tier** | Documents or rows | Faster than git; designed for app data; real-time updates available | Third-party signup; vendor lock-in concern parallel to the AI multi-vendor wish; free-tier quota limits |

*Working assumption for v1: GitHub repo of state files.* Supabase (or similar) is on the table if a DB is adopted for query-heavy data (§4.7). Not locked.

### 8.4 Conflict resolution

Single user across multiple non-simultaneous devices. Conflicts are expected to be **rare**. The handling strategy can be inconvenient or manual — that's acceptable — but must satisfy one hard invariant:

> **No loss of information the user has already provided.**

Two candidate approaches:

| Approach | Pros | Cons |
|---|---|---|
| **Three-way semantic merge on JSON** (compare base, remote, local field-by-field; auto-merge non-overlapping fields; surface true conflicts) | Robust; handles any data shape | Real implementation effort; per-domain conflict UI |
| **Data-shape choices that make conflicts vanishingly rare** (append-only logs, narrow scoped updates, time-keyed records) | Most conflicts dodge themselves | Limits how the bot can structure data; doesn't eliminate the residual case |

Hybrid is plausible: prefer conflict-rare shapes; fall back to semantic merge for the residual. *Open* (§17).

---

## 9. UI

### 9.1 Guiding principle: the UI follows the data, not use-cases

Because the data structure is the bot's responsibility and evolves over time (§4, §5), a use-case-driven UI design ("a screen for tasks, a screen for fitness plans, a screen for the leasing decision") is a losing battle — every new domain the user uses JADE LENS for would otherwise need a new UI screen.

Instead, the UI is **a comfortable, modern view onto the data as it is**, with a roughly 1-to-1 logical mapping to the underlying JSON files, markdown sidecars, and (if adopted) databases — *but it should not feel like a text editor with a JSON file open*. The shape is exposed; the experience isn't.

### 9.2 UI edits feed the same pipeline as bot edits

Every UI mutation produces the same artefact the bot produces — a JSON Patch (for inline JSON edits) or a full-content write to a markdown sidecar (for prose edits). These flow through the **same runtime pipeline** as bot output:

1. Inline-vs-sidecar promotion check (§4.3).
2. Patch verification.
3. Apply.
4. Record in the interaction log (§7), with a structured "user did X via UI" entry rather than a prompt/response pair.
5. Queue for sync.

This means **UI edits are indistinguishable from bot edits at the data layer** — one code path for all data mutation. A user appending three paragraphs to an inline JSON string via the UI triggers the same automatic promotion to a `.md` sidecar that the bot would.

### 9.3 Navigation: index as table-of-contents

The bot's index file (§4.5) doubles as the UI's navigation structure. A sidebar (or equivalent top-level view) renders:

- Primary JSON files, grouped by the index's groupings.
- Records inside each file, expandable.
- References to markdown sidecars as inline-followable links.

A search / filter affordance covers the cases where navigation isn't fast enough.

### 9.4 Default rendering vs. promoted views

**Default view.** For any JSON file without a special annotation, the UI renders a *typed-structured* view of the data: date-shaped fields as dates, references to sidecars as inline-followable links to their rendered markdown, arrays as lists, enum-shaped fields as dropdowns, etc. The shape maps 1-1 to JSON; the experience is "browsing structured records." Markdown sidecars render as formatted markdown, with edit mode opening a **WYSIWYG markdown editor**.

**Promoted views for very common patterns.** A small, fixed set of specialised views — calendar grid, kanban board, table, timeline — is supported as exceptions. The runtime knows which view to use via a per-file index annotation:

```json
{
  "calendar/events.json": {
    "description": "calendar events",
    "view": "calendar",
    "alwaysLoad": true
  }
}
```

The bot maintains the annotation when it creates or restructures the file. The UI honors it from a fixed **view registry** (a first-class concept in the runtime). The UI doesn't recognise data shapes itself — the bot tells it.

This keeps the surface finite: new domains don't require new UI screens; only the truly common shapes get specialised affordances. The same view registry is reusable by future features (§15.2) that let the bot embed rich payloads directly in chat responses.

The view registry is also the **schema registry** (§4.8) — registered types come with both a data shape (schema, enforced by the runtime) and a UI affordance (view). The bot's data-structure-design autonomy applies everywhere outside the registry; inside it, the bot follows the schema.

### 9.5 Other UI responsibilities

- Prominent **chat input** as the primary interaction surface (§5.1).
- **Sync status** surfaced non-intrusively (§8.2).
- **Cost ledger totals and threshold state** (§13).
- **Patch-verification failures** shown clearly with the option to manually resolve.
- **Settings panel** for vendor / model / key configuration (§11.3) and for picking a personal display name for the assistant (§9.6).

### 9.6 User-chosen assistant name

The display name the user sees when addressing the assistant is configurable in settings. Default is unset (no name used in chat); the user can pick any name they like. Suggestion: a link to a Wikipedia list of famous fictional AIs as a starting point.

Purely a personal-preference / fun feature — most users won't bother naming their assistant at all, and the bot doesn't need a name to function. Plays no role in the bot's instructions or behaviour beyond cosmetic display.

---

## 10. External Calendar (Special Case)

Most of JADE LENS's data is self-contained: the bot organises it, the UI views it, sync pushes it to the GitHub repo. **Calendar events are the exception**, and the design has to accommodate this.

### 10.1 Why calendar is exceptional

Four reasons:

1. **Events arrive from outside.** Work meeting invites, email "add to calendar" links, holidays from subscribed calendars, the shared calendar with one's partner — much of the user's calendar is authored elsewhere.
2. **Events need to be visible outside.** A shared family calendar, work calendar invites, anything where other people need to see the event — these have to round-trip to external systems.
3. **A lot of calendar content already exists** in the user's existing tools (Google / Apple / Outlook etc.); JADE LENS needs to be aware of it from the start.
4. **External calendar apps win on visualisation and feature depth.** JADE LENS will not replicate Google Calendar's UI and shouldn't try.

JADE LENS adds value not by *being* a calendar but by **knowing about** the user's calendar — reasoning about today's schedule alongside tasks and preferences, linking events to projects and notes, creating events from natural-language input.

### 10.2 Architectural shape: external is source-of-truth, JADE LENS augments

The cleanest split:

- **External calendar systems are the source of truth for the events themselves** — title, time, attendees, location, recurrence. (Google Calendar / CalDAV / iCloud / Outlook etc.)
- **JADE LENS stores augmentation records** — per-event notes (markdown sidecars), linked tasks / projects, prep checklists, follow-up reminders, anything JADE LENS-specific that doesn't belong in the external calendar.
- **Augmentation records reference external events by UID/ID** (calendars expose a stable identifier per event).

#### Calendar integration as a lazy-JSON-from-external-source pattern

The calendar integration is **an instance of the lazy-JSON-from-DB pattern (§4.7)**, with the "DB" being an external calendar API:

1. User prompt → bot derives what part of the calendar it needs (likely a date-window slice).
2. Runtime fetches current state from the configured external calendars via their APIs.
3. State is projected to an in-memory JSON view (a virtual `calendar/<scope>.json`-style file).
4. JSON view is shown to the bot.
5. Bot reasons about it; if creating / updating events, emits JSON Patches against the view.
6. Patches are translated back into external-calendar API calls (POST / PATCH / DELETE).

**Augmentation records are ordinary JADE LENS data** — separate JSON files referencing external event IDs. They live in the regular JSON+markdown world with no special handling.

Net effect: the bot doesn't need to know calendar is special. It sees JSON in, emits JSON Patches out. The runtime hides the API plumbing behind the lazy-JSON projection. Calendar becomes one (read-write) external source parallel to a DB.

#### Honest costs of the lazy-JSON-for-calendar approach

- **Cache fitness is worse than for stable JSON files.** The calendar view is volatile (other people modify shared calendars; the user's calendar gets updates from outside). The view should likely sit outside the cacheable prefix, or accept frequent cache misses.
- **Windowing is required.** A real calendar may hold years of events; the lazy view has to be a slice. Default heuristic: ±2 months from "now" (or from the query's date focus, if inferable); bot can request a wider window via a parameter.
- **API representation gaps.** Recurrence rules, exception dates, all-day events have no clean JSON representation in some APIs. The lazy view may need to expand recurrences into instances within the window (lossy but tractable).

### 10.3 Deep links in both directions

Symmetric linking is the polish target:

- **External event → JADE LENS notes.** When JADE LENS creates or augments an external event, it adds a URL field (description, custom property, or proper URL field where the protocol supports one) pointing to the JADE LENS app deep-linked to the relevant augmentation record. Clicking from the calendar opens JADE LENS at the right place.
- **JADE LENS event view → external calendar.** When the user clicks an event inside JADE LENS, they can jump to the external calendar app for the full feature set.

JADE LENS is hosted on GitHub Pages (a public URL); deep links encode "go to record X" via URL fragments or query parameters.

**Realistic UX caveat.** A deep link clicked from inside the Google Calendar Android app (or most other apps) typically opens in an **in-app browser** or a fresh browser tab — **not** in the installed PWA. To improve the chance of routing to the PWA on Chromium/Android, the manifest should declare:

```json
{
  "scope": "https://<username>.github.io/jade-lens/",
  "start_url": "https://<username>.github.io/jade-lens/",
  "display": "standalone",
  "handle_links": "preferred"
}
```

Even so, in-app browsers (Calendar's webview, Slack previewer, etc.) bypass this. Two practical consequences for the design:

1. **Fresh-load + deep-link is a first-class app entry path.** The SPA must read the URL fragment / query on startup, hydrate from IndexedDB or GitHub, and navigate to the right record. This is just standard SPA routing, but it has to work in a cold-start context.
2. **Multiple JADE LENS instances may be open simultaneously** (e.g. the standalone PWA window plus an in-app-browser tab from a calendar link). They share data via the remote substrate but not in-memory state — each is its own independent client. Slightly clunky but workable.

For users who find the round-trip UX too clunky, a **Trusted Web Activity** (TWA) escape hatch is available as future work — see §15.2.

### 10.4 Multi-calendar awareness

Real users have multiple calendars: personal-work, personal-private, shared-with-partner, subscribed (holidays), etc. Each has different ownership and write semantics. JADE LENS's calendar integration must:

- Read events across all configured calendars when reasoning.
- Respect read-only sources (don't try to write to a subscribed holiday calendar).
- Know which calendar to write to when creating new events (configurable defaults, optionally bot-inferable from context).

### 10.5 Phasing

| Phase | What works | Mechanism |
|---|---|---|
| **v1 (manual import)** | User pastes calendar info into JADE LENS chat. Bot creates augmentation records plus lightweight local "shadow" records of basic event info (title, date, attendees) so the bot can reason offline. No live API integration. | Bot/user chat only. |
| **Soon after v1** | Read access to external calendars via API. Bot fetches current events on demand and joins them with augmentation records at query time. | Adapters for Google Calendar / CalDAV. Read-only first. |
| **Mature** | Write access — JADE LENS creates and updates events in external calendars. Bidirectional deep links between external events and JADE LENS augmentation records. | Write API support per adapter; URL-field population on event creation. |
| **Polish** | Embedded calendar view in the JADE LENS UI (rendering external + augmentation state together), or smooth hopping between JADE LENS and the external calendar app. | Reuse the `view: "calendar"` registry entry (§9.4); deep links on both ends. |

---

## 11. Multi-Vendor Bot Support (design wish, not strict)

The user wants the *option* to swap between Anthropic, Gemini, and OpenAI without major refactoring. **Multi-vendor is a design wish, not a hard architectural requirement.** If other concerns dominate, sticking with Anthropic is acceptable.

### 11.1 Bot adapter layer

A clean seam between JADE LENS's bot-facing interface and any specific provider's SDK. JADE LENS speaks "prompt + tool specs → text and/or structured calls"; adapters translate to vendor APIs. Doesn't need to be fully provider-agnostic on day 1 — just a sensible boundary where vendor-specific code is contained.

### 11.2 Portable output formats

Format choices that preserve optionality at low cost:

- **Unified diff** for markdown updates (over Claude-Code-style search-and-replace blocks, which are Claude-specific).
- **JSON tool descriptions in the prompt** (over MCP server integration, which would still need per-vendor adapters at the wire-format level).

If a future feature genuinely benefits from a Claude-specific pattern at low portability cost, revisit case-by-case.

### 11.3 Manual vendor / model switching with cost visibility

**No automatic failover** (at least in early phases). The user wants to know which model is responding and to learn over time which models make which kinds of mistakes.

- A **settings panel** lists configured API keys, each tagged with vendor + model + paid/free.
- For each paid key: cumulative spend this month / this week.
- For each free-tier key: whether today's request limit is hit.
- When a key's threshold is crossed, the bot refuses the request and tells the user. The user goes to settings, picks a different key, retries.

---

## 12. Claude Code TUI Integration

For desktop use while coding in an IDE, JADE LENS is available inside the Claude Code TUI through a single **`/jade`** skill that covers all use cases (logging new information, querying old information, chatting). A symlink `/jv` may serve as a shortcut.

Setup:
- `alias claude='claude --add-dir /path/to/jade-lens'` in `.bashrc` / `.zshrc`.
- The skill operates on a local clone of the data and honours the same data conventions as the web app.

### 12.1 Shared data + shared mutation pipeline; divergent context-assembly

The web app and `/jade` share:

- The **data conventions** (JSON + markdown layout, index file with annotations, sidecar promotion rule, etc.).
- The **mutation pipeline** — a CLI/library that applies JSON Patches and unified diffs, verifies them, runs the inline-vs-sidecar promotion programmatically, writes the interaction log entry, and queues the change for sync. This is the same code used by the web app's runtime and by the `/jade` skill via a custom Claude-Code tool (see §12.2).

They differ in:

| Concern | Web app | `/jade` (Claude Code) |
|---|---|---|
| Context / discovery | We build prompts manually (index + alwaysLoad + history + per-turn data) | Claude Code agentically navigates the local repo with its native Read / Grep / Glob tools |
| Prompt cache management | We engineer breakpoints and structure the prefix | Claude Code handles its own caching |
| Cost ledger | Per-key per-model spend tracking with hard caps (§13) | Covered by the Pro subscription; nothing to track |
| Vendor adapter | Adapter layer (§11) for future Gemini/OpenAI swap | Claude-only by definition |
| Output / change format | Returned by the API | Returned by the bot **via the custom mutation tool** — same patch formats either way |

So the `/jade` skill is **not** a parallel implementation of the web app's logic. The mutation pipeline is genuinely shared; only context-assembly diverges (web-app-built vs. Claude-Code-agentic), and that's by design — we don't have an agentic loop in the web app on purpose (deterministic + cheap), and we wouldn't want to give one up in Claude Code (its agentic exploration is the whole point of using it).

### 12.2 The custom mutation tool

The `/jade` skill provides Claude Code with a custom tool — call it `handle_bot_response` for now — whose input is the same shape the web app's API responses use:

- **JSON Patches** for changes to JSON files.
- **Unified diffs** for changes to existing markdown files.
- **Lazy-JSON queries** for DB-backed data (§4.7) or external calendars (§10.2) — translated to API calls and projected to JSON the bot can read.

The tool routes through the **same runtime pipeline** as the web app: verification, programmatic inline-vs-sidecar promotion (§4.3), interaction log append (§7.1), queue for sync. Files end up structurally identical regardless of which client made the change.

**The SKILL.md is prescriptive:** the bot must NOT use Claude Code's native Edit / Write tools on data files; all mutations go through `handle_bot_response`. Reads via the native Read / Grep / Glob tools are fine and expected — discovery stays agentic. A sanity-check could flag out-of-band edits if compliance turns out to be a problem in practice.

### 12.3 Skill content converges with the web-app system prompt

Since the mutation tool's input format is the same as the web app's API response format, the SKILL.md and the web app's system prompt converge to **largely the same content** — both describe the data conventions and the protocol for emitting mutations. Just framed for their respective consumption contexts. A nice unification: one prompt-engineering effort, two clients.

### 12.4 Output capabilities — different from the web app, complementary

The `/jade` skill doesn't have the web app's view registry or rich visualisations, but the Claude Code TUI offers a different toolkit:

- **TUI-rendered markdown** in the chat, with good table support. Concise textual replies are the default surface and often enough.
- **Temp-file handoff** — for output that doesn't belong in chat (a long report, a generated checklist, a draft document), the bot writes to `/tmp/jadelens-...md` (or similar) and points the user at it. The user can open it in a text editor, in a browser, or — usefully — in the JADE LENS web app itself for richer visualisation. Pattern borrowed from the Librarian project.
- **File-pointers instead of content dumps** — when a query is essentially "find this in my data," the bot points at file + line range (`see projects/leasing/notes.md lines 14-22`) instead of re-quoting content the user already has on disk.

Token economics are softer under the Pro subscription (the user isn't directly paying per token in this path), but conciseness is still good practice — and pointing the user at canonical files rather than re-emitting copies keeps the user's data the single source of truth.

### 12.5 Read-tracking — not adopted

The idea of a `record_read` tool to log which files the bot consulted was considered and rejected for v1:

- Replay-based correction doesn't need it — replay re-creates file state and lets the bot read fresh.
- Logging every Read would be noisy (Claude Code reads many files exploratorily).
- Bot compliance is likely lower for reads (casual, not deliberate) than for mutations.

Optional later: the bot may *self-report* a load-bearing read in its response prose ("after consulting `projects/leasing/comparison-notes.md`, I decided X"). That's bot reflection, not blanket logging, and it costs nothing to support.

### 12.6 Scope and phasing

Given that the `/jade` skill amounts to a SKILL.md + the custom mutation tool wrapping the existing pipeline + the `claude` alias setup, it's **planned for v1**. The cost is dramatically lower than "a second implementation."

### 12.7 Skill name (user-configurable)

The default slash command is `/jade`. At install time, the user is asked whether they want to use a different name (and perhaps a default suggestion is derived from the name the user chose in the web app, e.g. "Bob" → `/bob`). If a different name `<name>` is desired, a gitignored symlink to the `/jade` skill is created, so the user can call `/<name>` instead. A link to a Wikipedia list of famous fictional AIs can serve as inspiration for those who want to pick a new name.

---

## 13. Cost Transparency and Efficiency

### 13.1 Cost ledger

Every API call's usage is recorded locally from the response metadata. No client-side tokenizer; no pre-call estimation.

The ledger keys on the **API key used** (not just on vendor + model), because the user may have multiple keys against the same vendor.

For paid keys, the ledger tracks cumulative spend per period (day, week, month).
For free-tier keys, the ledger tracks whether the daily quota is hit. Different semantics; both visible.

### 13.2 Thresholds

Two configurable thresholds per key:

- **Warning threshold** — UI surfaces a warning when crossed.
- **Hard cap** — the bot refuses further calls on that key until the period rolls over or the user picks another key.

Overshoot of one in-flight call is acceptable (the user accepts a few-dollars-worst-case overrun).

### 13.3 Summary views

Daily, weekly, and monthly cost summary views in the UI, per key and aggregate.

### 13.4 Rate model

The running estimate uses **non-cached rates** — pessimistic, so actual spend is at-or-below the displayed number. Cache-discount modelling is deferred; the pessimistic bias errs toward caution, which is the right direction.

### 13.5 Token-cost as a design metric

Output-token frugality drives several choices throughout the design:

- Compact patch formats (JSON Patch, unified diff with 0 context).
- Programmatic inline-vs-sidecar promotion (the bot doesn't emit two-op responses).
- Cache-friendly index structure (no fields that mutate on every write).
- Eager-load-everything as the v1 discovery flow, keeping per-query rounds at one.
- **Model-right-sizing per chat, not per turn.** Pick the model when a chat starts and stick with it — the prompt cache is keyed by `(model, prefix)`, so switching mid-chat invalidates the cache the previous model had built up (§6.1). Heuristics: Haiku-class for routine quick chats (log this, what's on my calendar); reach for Sonnet when the chat needs heavier reasoning (multi-turn planning, research synthesis). Mid-chat escalation is allowed when genuinely necessary, but pays a cache-cold-start cost — avoid as a default.

---

## 14. Versioning and Migration

The mechanism that lets v0.1.0 ship with an imperfect design and evolve safely. Many design choices will only crystallise with real day-to-day usage; this strategy lets the user start using a working-but-incomplete app and reshape both code and data in lockstep across releases.

### 14.1 Versions

- The **code repo** has a code version (e.g. `1.5.42`), embedded in the build.
- The **data repo** has a `version` file containing the current data version as a string.
- **Migration scripts** live in the code repo under `migrations/<target-version>.md`. The filename target version determines order; semver-sorted by the runtime.

### 14.2 Migration script format

Each migration is a markdown file with instructions the bot follows — structurally similar to a Claude Code skill. The bot reads the instructions and transforms the data from the previous version to the target version.

Migration scripts mix two registers:

- **Natural-language instructions** for semantic / subjective work the bot is well-suited for — *"make all task descriptions more concise,"* *"merge any duplicate research records on the same topic."*
- **Tool calls to Python helpers** in the code repo for mechanical work — *"for every task record, rename field `description` to `summary`."*

The mix is cost-disciplined: bulk-mechanical work goes through deterministic Python (free, fast, reliable); semantic work goes through the bot (the only thing that can do it). Renaming a field across a year of accumulated records via JSON Patches emitted by the bot would be prohibitively expensive in tokens; running a 10-line Python script over the same data is free.

### 14.3 Self-update

The running code keeps itself current before any data work happens.

**Web app**:
- Embed the current version in a `<meta name="app-version">` tag in `index.html` (rarely cached aggressively).
- Bundle the same version into a JS constant in the application bundle (heavily cached).
- On every startup, compare the two. Mismatch → cache is stale → reload with cache-bust (and/or unregister the Service Worker if we ship one).
- Works around GitHub Pages caching without anything exotic. Service Worker integration can come later as polish.

**`/jade` Claude Code skill**:
- On invocation, `git pull` the code-repo local clone.
- **Caveat**: a running Claude Code session does not re-read its skills mid-session. So a `pull` mid-session doesn't propagate. Mitigation: the skill checks its own version on every invocation and refuses to proceed if stale, asking the user to restart Claude Code so the new skill version is loaded.

### 14.4 Version comparison on every load

After self-update completes and the code is at its latest, the runtime compares the data-version against the code-version:

| Comparison | Action |
|---|---|
| `data > code` | **Error.** Refuse to proceed. Ask the user to handle — typically means another device has migrated the data forward and this device's code is behind. |
| `data == code` | Normal operation. |
| `data < code` | Run the migration flow (§14.5). |

### 14.5 Migration flow

1. **Pre-check.** Ask the user to review the data — especially recent changes — and fix any mistakes manually or via replay-based correction (§7.2). **This is the user's explicit accept-replay-boundary moment** (§14.6).
2. **Checkpoint.** Once the user confirms the data is correct, create a checkpoint tag in the data repo (named after the version transition, e.g. `pre-migration-1.5.41-to-1.5.42`).
3. **Collect.** Gather all migration scripts whose target version lies in `(data-version, code-version]`, sorted in semver order.
4. **Dry-run summary.** Show the user a per-script summary of what each migration will do. Ask for confirmation before applying.
5. **Apply.** Run the migrations in order. The bot follows each script's instructions; Python helpers run when invoked.
6. **Bump version.** Set the data-version to the current code-version — *always*, even if no migrations applied (covers the "no relevant migrations existed in this release range" case cleanly).
7. **Commit.** Commit the data changes + the new version file. Optionally tag a successful-migration marker.
8. **New interaction log.** Start a new interaction-log file for the new version (naming convention TBD — likely `interactions/<version>.log` or similar). The old log remains for historical reference but is not actively appended to anymore.

### 14.6 Crossing the replay-boundary

Replay-based correction (§7.2) does **not** compose freely with migrations. Once a migration has changed the data shape, interaction-log entries from before the migration reference shapes that no longer exist; replaying them may not work.

The pre-checkpoint verification step in §14.5 IS the user's explicit acknowledgment that they're crossing this boundary. UI messaging at that step must make it clear:

> *After this checkpoint, mistakes made before the migration cannot be fixed via replay anymore. Please make sure the data is correct now, before we proceed.*

### 14.7 Interrupted migration recovery

If a migration is interrupted partway through — browser crash, power loss, user closes the tab, Claude Code session kills mid-tool-call — the data may be in an intermediate state.

Because the data-version file is updated only at step 6 (the very end of `§14.5`), the next startup still sees `data < code` and re-engages the migration flow. The recovery action is:

> **Reset to the pre-migration checkpoint tag (created in step 2) and retry the migration from scratch.**

**Idempotency is NOT required of individual migration scripts.** Idempotence is realistic only for purely mechanical changes; subjective natural-language instructions to the bot cannot be guaranteed idempotent. The reset-then-retry pattern sidesteps the issue entirely.

### 14.8 Migration testing discipline

Release-time concern, not a runtime concern: before shipping a migration in a release, run it against a snapshot of pre-version data locally and verify the result. Catch breakage at release time, not at the user's startup.

This is especially important because the bot is involved in execution — a migration that worked yesterday may behave subtly differently if model versions or prompt shapes have drifted. Pinning the model version used during migration runs is worth considering.

## 15. v1 Scope and Future Work

### 15.1 Roughly in v1

- React + Vite static SPA on GitHub Pages.
- Linux desktop, macOS, Android (same static web build).
- JSON + markdown data model with the programmatic inline-vs-sidecar promotion rule and hysteresis.
- The index file with `alwaysLoad`.
- Preferences treated as normal data with `alwaysLoad`.
- The interaction log (without sophisticated replay-correction *tooling* yet — see below).
- Local-first sync against a GitHub repo of state files (no DB).
- Single bot vendor active (Anthropic, via either Claude API or Claude Code), behind an adapter layer designed to admit others later.
- Cost ledger with daily / weekly / monthly summaries and a hard cap per key.
- Manual vendor / model / key switching in settings.
- Patch-verification with failure surfacing to the user.
- Eager-load-everything discovery flow, with sidecars eagerly loaded with their parent JSON.
- Chat UI with prominent input + default typed-structured rendering of JSON data + WYSIWYG markdown editor for sidecars. The promoted-view registry (calendar / kanban / table / timeline) is in place as a concept, but specialised renderers can be implemented incrementally as the data shapes that need them emerge.
- **Manual calendar event import** via chat paste — the bot creates augmentation records and lightweight local shadow records for offline reasoning. No live external-calendar API integration yet (§10).
- **`/jade` Claude Code skill** for in-IDE use — a SKILL.md describing the data conventions + the `handle_bot_response` custom tool that routes mutations through the same pipeline as the web app (§12). Lightweight; ships with v1 because the mutation pipeline is already built for the web app and the skill is a thin tool wrapper around it.
- **Versioning and migration system** (§14). Both clients carry a code version, the data repo carries a `version` file, the runtime self-updates and runs the migration flow on every load. v0.1.0 ships with the framework in place (version files, comparison logic, self-update mechanism, migration script discovery + execution, checkpoint tagging), even if the only "migration script" so far is the trivial v0.0.0 → v0.1.0 bootstrap.
- **Two-repo split** (§3) — this code repo plus a separate private data repo. The web app and `/jade` skill read the data-repo location from a setting (or env var, for a single-user install).

### 15.2 Future work (post-v1 or as the project matures)

- **`/jade` Claude Code skill polish.** The skill itself is planned for v1 (§12.6). Future polish: richer shell helpers, smarter SKILL.md heuristics shaped by observed bot compliance, optional bot self-reported load-bearing-read logging (§12.5).
- **Multi-vendor active support** — Gemini and OpenAI adapters, parallel to Anthropic.
- **Structured data-request discovery flow** — transition from eager-load-everything when data grows.
- **Tool-use-driven discovery** — only if iterative exploration genuinely earns its keep.
- **Replay-based correction UI** — the rewind → replay-with-hint → OK-or-corrected loop made operationally accessible. v1 has the log; the UI for it can come later.
- **Database adoption for query-heavy data** — to-do filtering, calendar querying. Supabase or similar via the lazy JSON pattern.
- **Cross-chat history continuity** — re-loading prior chat threads when picking up a multi-day project conversation.
- **Sophisticated conflict resolution** — if real conflicts appear in practice beyond the "rare and manual" baseline.
- **Cache-discount modelling** in the cost ledger, once the actual caching pattern is observable.
- **External calendar API integration** (the core path of §10). Read access first (Google Calendar / CalDAV / iCloud / Outlook adapters). Then write access — JADE LENS creates and updates events in external calendars. Then bidirectional deep links between external events and JADE LENS augmentation records. Embedded calendar view in the JADE LENS UI (via the `view: "calendar"` registry entry) as the final polish step.
- **Trusted Web Activity (TWA) for Android** as a deep-link UX escape hatch. A thin Android wrapper around the PWA, distributed as an APK, with a verified `assetlinks.json` so calendar deep links route reliably into the installed app rather than opening as a browser tab or in-app webview (§10.3). Adds APK build + sideload friction; only worth doing if the PWA-only deep-link experience becomes annoying in practice.
- **External integrations** (Confluence, Slack, Drive, Jira, Zoom) — only if the use case actually shows up.
- **Rich-payload bot responses in chat.** Bot responses can include JSON or markdown payloads tagged with one of the registered view types (`calendar`, `kanban`, `table`, ...), which the UI renders inline using the same view registry that powers the index `view:` annotation. Optional **home dashboard** where recent rich responses persist temporarily (or are pinned by the user). Optional **interactive rendered content** — e.g. a generated to-do list whose tick actions translate to JSON Patches against the underlying records via the standard pipeline (§9.2).
- **Easy export of selected data** for use elsewhere. Driver: the user has a Claude Pro subscription that covers claude.ai but not the API. For long-form discussions, claude.ai is the cheaper surface — JADE LENS's chat UI is then reserved for shorter conversations, queries, and clarifications. Possible one-click flow: copy relevant data slice to clipboard and open claude.ai (or another external chat surface). Format-agnostic export (JSON, markdown, plain text) for ad-hoc transfer.
- **Claude-Code-subprocess transport for the desktop web app.** A speculative cost optimisation: instead of calling the Anthropic API (paid) from the desktop build of the web app, spawn Claude Code as a subprocess and route through the Pro subscription. Was rejected earlier as a primary path, but the mutation-tool design in §12 makes this *substantially less painful* than originally feared — replacing the API transport with a subprocess transport is mostly "wire the subprocess to fire our existing `handle_bot_response` tool," not "rebuild parsing for Claude Code's native output." Still real implementation work (subprocess lifecycle, session management, streaming). Only worth doing if observed API costs on desktop actually warrant it.
- **Authentication and protected-data tier** (v2+). Three layers, all client-side (no backend needed):
  - **UX-only lock** — PIN/password prompt at app start; active "lock now" button when handing the phone to someone else. Doesn't protect data at rest; protects against casual peeking only.
  - **At-rest encryption for protected records** — per-record `protected: true` annotation in the index. Protected records are encrypted client-side with a key derived from the user's password (PBKDF2/Argon2 → AES-GCM) or, where supported, from WebAuthn's PRF extension (biometric — fingerprint / Face ID / Touch ID). Encryption applies both to local storage (IndexedDB) and to data pushed to the remote substrate. Unprotected data stays plaintext for human-readability.
  - **Vendor-trust filtering** — each configured API key carries a trust label (e.g. `untrusted` for free-tier vendors with retention concerns). The bot adapter excludes protected records from prompts to untrusted keys, telling the bot some data is being withheld so it can ask the user to switch keys if needed. Pure policy; no crypto required for this layer.
  - Caveats to plan around: mixed protection levels in one repo (visible in raw inspection), sync paused for protected data while locked, recovery semantics if the password/biometric is lost.

---

## 16. Guiding Principles (compressed)

- **The bot designs the data structure.** Files, schemas, organisation evolve with use; no upfront schema design.
- **Files (JSON + markdown) are the source of truth.** Human-readable, LLM-friendly, version-controllable.
- **Local-first.** The UI never blocks on the network. Remote sync is a background concern.
- **Audit by interaction log, not by giant commit messages.** Enables replay-based correction.
- **Cost-aware by design.** Output-token frugality drives patch format, cache structure, model selection, and discovery flow.
- **AI substrate is open and pluggable at low cost** — design preserves multi-vendor optionality, but doesn't pay heavily for it.
- **No information loss.** Conflict resolution can be manual or inconvenient, but never silently drops user-provided data.

---

## 17. Open Questions

The following are explicitly not yet decided. Each may close out during implementation as the constraints become concrete.

- **Remote storage substrate** — GitHub repo of files vs. GitHub with fine-grained patch-log-style commits vs. Firebase/Supabase (§8.3). *Working assumption: GitHub repo.*
- **Whether to adopt a database in v1** for query-heavy data (§4.7). *Working assumption: no DB for v1.*
- **Conflict resolution mechanics** (§8.4) — semantic merge vs. data-shape choices vs. hybrid. Mostly insurance for the single-user-multi-device pattern.
- **Sidecar filename convention** (§4.4) — hash vs. JSON-path-derived vs. sidecar-directory-per-JSON. *Leaning sidecar-directory.*
- **Specifics of the bot's awareness of recent UI edits.** The §9.2 unified pipeline ensures UI edits land in the same files and the same interaction log as bot edits, so the bot's next read of state is current by construction. Open sub-question: whether the bot should be shown recent UI-edit log entries as context ("the user just added X via the UI") to inform its reasoning, or whether the data state alone is sufficient signal.
- **Data types to enumerate beyond the obvious** — to-do, calendar, projects, notes, presentations, preferences are clearly in scope. The full list emerges from use.
- **Discovery-flow transition threshold** (§6.3) — at what data volume to graduate from eager-load-everything to structured data requests.
- **Cross-chat history retrieval** — whether and how to continue conversations across days or weeks by re-loading a prior chat thread's history into context.
- **Structure of this repo** — is this where both code and data live? Should there be a separate repo for each? If together, how should we organize the files?
- **Logo/Icon** — This app will have an entry point in the home screen of each device. It needs an awesome logo!
