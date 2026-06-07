# CLI and skill for the first release of JADE LENS

## The `jadelens` command-line tool

- `jadelens init <path>` — set up a brand-new data repo: prompts for the assistant name and the user's names, clones the (empty) GitHub repo, writes the required files, renders the skill, and makes the first commit and push.
- `jadelens apply <data-repo>` — the mutation tool the bot uses: reads a batch of operations on stdin, applies them atomically, commits, and syncs.
- `jadelens render <data-repo>` — render the skill into the data repo from the bundled template and the repo's config.
- `jadelens stash <data-repo> --list | --resolve <id>` — review and clear conflict-stashed changes.

## The `/jade` skill (Claude Code)

- A single agentic skill, invokable as `/<assistant-name>` from any Claude Code surface (desktop, claude.ai web and mobile).
- Rendered from a bundled template into the data repo at `.claude/skills/<name>/SKILL.md`, with the user's and assistant's names filled in.
- Tells the bot the data conventions (JSON + markdown, wikilinks, the index, human-readable names, ISO dates) and the mutation protocol. The bot reads freely with the native tools but makes **all** changes through `jadelens apply`.

## Session-start hook and bootstrap (`.claude/`)

- `jadelens init` also writes `.claude/settings.json` (registers a session-start hook) and `.claude/hooks/session-start`.
- On every session start the hook installs `jadelens` if it's missing (from the `cli-latest` tag), re-renders the skill, and — on desktop — symlinks it into `~/.claude/skills/` so `/<name>` works from any directory.

## The mutation pipeline

- Five operations: `json_patch`, `unified_diff`, `create_file`, `delete_path`, `rename_path`.
- A batch is applied all-or-nothing and produces one git commit plus one operations-log entry.
- Wikilink references stay consistent automatically: rewritten on rename, checked on delete.
- Auto-sync: pulls before applying and pushes after; a cross-device conflict is set aside in the stash rather than lost.
- The same pipeline runs in the web app, kept byte-for-byte identical by a shared conformance suite.
