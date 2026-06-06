# External calendar

*(Intended design. Only the **v1 manual-import** phase is in immediate scope, and
even that is mostly skill/data conventions; the API integration phases are future
work.)*

Most of JADE LENS's data is self-contained. **Calendar events are the
exception** — they arrive from outside (invites, shared calendars, subscriptions),
need to be visible outside, already exist in the user's other tools, and external
calendar apps win on visualisation. JADE LENS adds value not by *being* a calendar
but by **knowing about** the user's calendar — reasoning about today's schedule
alongside tasks and preferences, linking events to projects and notes, creating
events from natural language.

Related: [data-model.md](data-model.md) (the lazy-JSON pattern and the view
registry this reuses), [web-app.md](web-app.md) (the promoted calendar view).

## Shape: external is source-of-truth, JADE LENS augments

- **External systems are the source of truth for the events themselves** — title,
  time, attendees, location, recurrence (Google Calendar / CalDAV / iCloud /
  Outlook).
- **JADE LENS stores augmentation records** — per-event notes (markdown sidecars),
  linked tasks/projects, prep checklists, follow-ups — anything JADE LENS-specific
  that doesn't belong in the external calendar. They reference external events by
  their stable UID/ID and are **ordinary JADE LENS data** (plain JSON + markdown,
  no special handling).

### Calendar as a lazy-JSON-from-external-source

The live integration is an instance of the lazy-JSON pattern
([data-model.md](data-model.md)), with the "DB" being an external calendar API:

1. User prompt → bot derives what slice it needs (likely a date window).
2. Runtime fetches current state from the configured calendars.
3. State is projected to an in-memory JSON view (a virtual `calendar/<scope>.json`).
4. The bot reasons about it; to create/update events it emits JSON Patches against
   the view.
5. Patches translate back into calendar API calls (POST / PATCH / DELETE).

The bot never knows calendar is special — JSON in, JSON Patches out; the runtime
hides the API plumbing.

**Honest costs.** Cache fitness is worse than for stable files (the view is
volatile — others edit shared calendars), so the view likely sits outside the
cacheable prefix. Windowing is required (default heuristic: ±2 months from now or
from the query's date focus; wider on request). Recurrence rules / exception dates
/ all-day events have no clean JSON form in some APIs, so the view may expand
recurrences into instances within the window (lossy but tractable).

## Multi-calendar awareness

Real users have several calendars (work, private, shared-with-partner, subscribed
holidays) with different ownership and write semantics. The integration must read
across all configured calendars, respect read-only sources, and know which
calendar to write to for new events (configurable defaults, optionally
bot-inferable).

## Deep links (both directions)

- **External event → JADE LENS** — when JADE LENS creates/augments an event it
  adds a URL pointing back to the app deep-linked to the augmentation record.
- **JADE LENS → external** — clicking an event in-app can jump to the external
  calendar app for the full feature set.

JADE LENS is a public GitHub Pages URL; deep links encode "go to record X" via URL
fragments/params. **Caveat:** a link clicked from inside the Google Calendar app
(or most apps) usually opens an in-app browser or a fresh tab, not the installed
PWA. The manifest declares `handle_links: "preferred"` + a tight `scope`/
`start_url` to improve PWA routing on Chromium/Android, but in-app browsers bypass
it. Two consequences: **fresh-load + deep-link is a first-class entry path** (the
SPA reads the URL on cold start, hydrates, navigates), and **multiple instances
may be open at once** (PWA window + in-app-browser tab) — independent clients
sharing data via the remote substrate. A **Trusted Web Activity** Android wrapper
is a future escape hatch if the round-trip UX gets annoying.

## Phasing

| Phase | What works | Mechanism |
|---|---|---|
| **v1 (manual import)** | User pastes calendar info into chat; the bot creates augmentation records + lightweight "shadow" records (title/date/attendees) for offline reasoning. No API. | Chat only. |
| **Soon after v1** | Read access to external calendars; the bot fetches events on demand and joins them with augmentation records at query time. | Google Calendar / CalDAV adapters, read-only first. |
| **Mature** | Write access — JADE LENS creates/updates external events; bidirectional deep links. | Write API per adapter; URL-field population on create. |
| **Polish** | Embedded calendar view in JADE LENS, or smooth hopping to the external app. | The `view: "calendar"` registry entry ([web-app.md](web-app.md)) + deep links. |
