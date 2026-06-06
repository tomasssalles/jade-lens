# Audit and correction

JADE LENS keeps a full audit trail of data changes and fixes mistakes by writing
forward, never by rewinding history.

Source of truth: `jadelens/workflow.py` (`append_log_entry`, the commit) and
`web/src/mutation/workflow.js` (`appendLogEntry`). Related: `mutation-pipeline.md`
(what produces a change), `sync-and-conflicts.md` (the stash, which is *excluded*
from the log).

## The atomic data change is the unit of audit

Every **atomic data change** produces exactly **one git commit + one log entry**,
regardless of entry point — a `/jade` tool call emitting one or more operations, a
UI edit in the web app, or any future entry point. Pure queries (a `/jade` call
that changes nothing, UI navigation, a bot answer) produce no commit and no log
entry; the Claude Code chat is the user's ephemeral record of those.

## The operations log

An append-only **JSONL** log under `.jade/operations-log/`, one file per data-repo
version: `.jade/operations-log/<version>.jsonl` (e.g. `…/v0.1.0.jsonl`). Old
versions remain alongside as historical records after a migration
(`versioning.md`). Each line is one atomic change:

```json
{"ts":"2026-05-18T14:23:11Z","commit_message":"<one-line summary>","operations":[<op>,<op>]}
```

The `operations` field holds the same typed structures the bot or UI emitted
(`mutation-pipeline.md`). The line is serialised in the **compact JS-canonical
form** (`JSON.stringify(obj)` — no spaces, `ensure_ascii=False`,
integer-valued-float→int) so the Python and JS clients write byte-identical log
lines.

**No prompt, no response text, no commit SHA.** The commit identity is recoverable
from git: each atomic change adds exactly one line to the log file, so line N maps
to the Nth commit that touched the log. The runtime is the only writer; if an
external editor breaks that assumption, only that one entry's bijection breaks.

**The commit message is duplicated, intentionally** — it also lives in git's
commit message (below). Keeping it in the log entry too makes the log
self-sufficient as the canonical audit record, so a future move off git (e.g. to
Postgres — `versioning.md`) doesn't lose intent metadata.

**Why a log at all, when git has diffs?** It preserves operation *semantics* a
raw diff would lose — most notably a JSON Patch `move`, which a diff shows as
delete-here + add-there but the log shows as one intent-carrying op. It also
allows programmatic introspection ("every inline→sidecar promotion", "every rename
this week"), valuable while tuning bot behaviour.

**Scope: applied changes to the user's data only.** Repo machinery isn't logged —
not the log file itself, not stash files (`sync-and-conflicts.md`). And a batch
that was **rolled back** rather than applied (a conflict stashed instead of
landing) never appears; the stash entry is its sole record. This keeps the log a
linear series of changes that actually brought the data to its current state.

## Commit messages

The commit message describes intent.

- **`/jade` (Claude Code):** the bot writes a concise one-line message in the tool
  call. It does **not** repeat the user's verbatim prompt — that costs real output
  tokens (Pro time + rate-limit budget) and the prompt is often meaningless
  without the surrounding chat anyway.
- **Web app (bot):** the runtime knows the prompt programmatically and could use
  it at zero token cost; verbatim vs. summary vs. both is a later decision.
- **UI-only edits:** the runtime writes the message itself — a static op
  description plus the affected file(s), e.g. `Manual edit: toggled checkbox —
  projects/leasing.md`. Intentionally redundant with the log entry; the point is a
  skimmable, searchable `git log`.

## Forward-only correction

JADE LENS does not rewind or replay history. When the user spots a mistake, they
say so in natural language — *"no, I meant the read-replica, not the primary"* —
and the bot reads the relevant data, understands the mistake, and writes the fix
forward, in the same batch chasing down any references the correction invalidates
(wikilinks make path fan-out tractable — `wikilinks.md`).

**Why not replay-with-fixes?** Two reasons. First, on the `/jade` path the runtime
only sees the bot's tool inputs, never the surrounding chat — the "prompts" we'd
replay are decontextualised stubs. Second, even with perfect chat capture,
reactive multi-turn conversations can't be deterministically replayed: change the
data and the bot's response changes; change that and the user's next message would
have changed too. Replay-with-fixes is an illusion; forward-only is the honest
envelope.

## Mobile substrate note

Mobile reads/writes the data repo via the GitHub API (`jadelens.md` — "no
mobile-native daemons"), not a local clone, so mobile devices never carry `.git/`
— only the working-tree files. The operations log is a normal tracked file under
`.jade/operations-log/` and travels with the rest of the data; it's tiny (one JSON
line per change).
