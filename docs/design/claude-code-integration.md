# Claude Code integration

JADE LENS is invokable from every Claude Code surface — desktop TUI, claude.ai
browser, claude.ai mobile — through a single **`/<assistant.name>`** skill (the
user's choice; package default `/jade`). The skill covers all use cases: logging
new information, querying old information, chatting. This path is **built**.

Source of truth: [jadelens/cli.py](../../jadelens/cli.py) (the `jadelens` CLI),
[jadelens/templates/skill/](../../jadelens/templates/skill/) (the skill
templates), [jadelens/templates/session-start-hook.sh](../../jadelens/templates/session-start-hook.sh),
[jadelens/skill.py](../../jadelens/skill.py) (render + marker). Related:
[mutation-pipeline.md](mutation-pipeline.md) (the shared pipeline the tool wraps),
[versioning.md](versioning.md) (the version-pinned install, future).

## Shared pipeline, divergent context-assembly

The web app and `/jade` share the **data conventions** ([data-model.md](data-model.md),
[wikilinks.md](wikilinks.md)) and the **mutation pipeline**
([mutation-pipeline.md](mutation-pipeline.md)). They differ only in
context-assembly:

| Concern | Web app | `/jade` (Claude Code) |
|---|---|---|
| Context / discovery | Prompts built deterministically (index + alwaysLoad + history + per-turn data) | Claude Code navigates the repo agentically with native Read / Grep / Glob |
| Prompt cache | We engineer breakpoints | Claude Code handles its own |
| Cost ledger | Per-key spend tracking ([cost.md](cost.md)) | Covered by the Pro subscription |
| Vendor | Adapter layer for future Gemini/OpenAI | Claude-only by definition |
| Output / change format | Returned by the API | Returned via the mutation tool — same patch formats |

So `/jade` is **not** a parallel implementation — the pipeline is genuinely shared;
only context-assembly diverges, by design (the web app stays deterministic + cheap;
Claude Code keeps its agentic exploration, which is the point of using it).

## The mutation tool

The skill gives Claude Code a single mutation tool: `jadelens apply <data-repo>`
(a console script shipped by the `jadelens` package, installed via `uv tool
install`). Its input is the same shape the web app's pipeline takes — a
`commit_message` + the five-op list — passed as one JSON object on stdin via
heredoc. See [mutation-pipeline.md](mutation-pipeline.md) for the wire format,
validation, atomicity, and the cross-client byte-identity contract.

**The SKILL.md is prescriptive:** the bot must NOT use Claude Code's native Edit /
Write tools on data files — all mutations go through `jadelens apply`. Reads via
native Read / Grep / Glob are fine and expected; discovery stays agentic.

Because the tool's input format equals the web app's, the SKILL.md and the web
app's system prompt converge to largely the same content — one prompt-engineering
effort, two clients.

## Output capabilities (complementary to the web app)

`/jade` has no view registry, but the TUI offers its own toolkit:

- **TUI-rendered markdown** with good tables — concise textual replies are the
  default surface and often enough.
- **Temp-file handoff** — output that doesn't belong in chat (a long report, a
  draft) is written to `/tmp/jadelens-…md` and the user is pointed at it (openable
  in an editor, a browser, or the JADE LENS web app for richer rendering).
- **File-pointers instead of content dumps** — "find this in my data" answers
  point at file + line range rather than re-quoting content the user already has.
- **Tool-result echoes of applied operations** — `jadelens apply` returns the
  operations it applied; Claude Code shows tool results inline, giving the user a
  visible record of what changed without the bot paying tokens to repeat it.
- *Future, not v0.1.0:* **ANSI styling** in tool results (highlight diff hunks /
  JSON keys); **side-effect surfacing in the reflection** — the current reflection
  mirrors only the bot's original ops, not runtime side effects (wikilink rewrites
  from `rename_path`, future promotions); the information is available
  (`rewrite_references_under` returns the modified files) but not yet surfaced.

**Read-tracking is not adopted.** A `record_read` tool was considered and rejected:
the operations log captures *mutations* by design ([audit-and-correction.md](audit-and-correction.md)),
reads are noisy and exploratory, and compliance would be low. The bot may
*self-report* a load-bearing read in prose ("after consulting X, I decided Y") —
reflection, not blanket logging.

## Installation and bootstrap

A data repo is a self-contained install: its own config, its own session-start
hook, its own rendered skill.

### `jadelens init` *(built)*

`jadelens init <path>` scaffolds a brand-new data repo end to end
([jadelens/cli.py](../../jadelens/cli.py)): it interactively collects the assistant
name and the user's names (validating the SSH URL and refusing the code repo),
clones the (empty) data repo, writes the bootstrap files, renders + symlinks the
skill, then commits and pushes. The files it writes:

- `.jade/config.json` — `user.full_name`, `user.short_name`, `assistant.name`,
  shared across the user's devices.
- `Index.json` — empty array ([data-model.md](data-model.md)).
- `.gitignore` — ignores `.claude/skills/` (the rendered skill).
- `.claude/settings.json` — registers the `SessionStart` hook.
- `.claude/hooks/session-start` — the hook (below), made executable.
- `CLAUDE.md` — instructs the data-repo bot to always work on `main`.

### The session-start hook

Committed to the data repo at `.claude/hooks/session-start`, it runs on every
session start (any surface):

1. Compute the data-repo path from `${BASH_SOURCE[0]}`.
2. If `jadelens` isn't on `PATH`, `uv tool install … @cli-latest` (idempotent — a
   developer's editable `uv tool install -e` no-ops).
3. `jadelens render <data-repo>` — reads `.jade/config.json`, picks the
   highest-version bundled template, writes the rendered skill. **No-op if the
   SKILL.md already exists** — refresh-by-delete is the rebuild loop.
4. On desktop (silent no-op elsewhere): symlink `~/.claude/skills/<name>/` → the
   data-repo skill dir, so `/<name>` works from any cwd; otherwise print the exact
   `ln -s` command.

Claude Code auto-discovers skills under `.claude/skills/<name>/` from the repo
root, so no alias or installer is needed; the symlink just extends reach to any
cwd on desktop.

### Templates and the version marker

Templates live as package resources at
[jadelens/templates/skill/](../../jadelens/templates/skill/)`v<X.Y.Z>.md`;
`uv tool install` ships them and `importlib.resources` reads them whether the
install is editable or a built wheel. The rendered SKILL.md carries a marker —
`<!-- jade-lens-skill template-version=v0.1.0 -->` — holding **only the template
version**; config values are substituted into `{{PLACEHOLDER}}` slots at render
time.

### Updates and config changes

- **Update the code/skill:** editable installs see new code + template on the next
  session (delete the rendered skill dir to re-render). claude.ai cold sessions
  re-install from the pinned ref each time. (A first-class `jadelens update` tool is
  planned — [versioning.md](versioning.md).)
- **Rename the assistant / change names:** edit `.jade/config.json`, delete the old
  rendered skill dir (and the old home-dir symlink), start a fresh session — the
  hook re-renders under the new name.

### Version pinning *(future tie-in)*

The hook currently pins the install to a moving **`@cli-latest`** tag. Once the
versioning system lands ([versioning.md](versioning.md)), the ref becomes
`@$(cat .jade/version)`, making a data-version bump the explicit trigger for
picking up the matching code.

### Multi-data-repo

Each data repo is independent — its own hook, its own `assistant.name`, its own
rendered skill. Home-dir symlinks at `~/.claude/skills/<each-name>/` coexist as
long as the names differ (e.g. `/jade` for personal, `/family-jade` for a shared
repo). No central installer knows about all of them.

> The legacy file-by-file setup walkthrough lives in
> [legacy-docs/docs/data-repo-setup.md](../../legacy-docs/docs/data-repo-setup.md)
> (largely superseded by `jadelens init`; fold any still-useful detail here when
> `legacy-docs/` is retired).
