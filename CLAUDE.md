# JADE LENS — AI personal assistant

JADE LENS is a personal AI assistant for the messy parts of life-admin (tasks, projects, notes, plans, preferences). Three pieces work together:

- **The assistant** — a Python CLI (`jadelens`) plus a rendered agentic skill (Claude Code today). The user talks to it; it turns chaotic input into well-organized, structured data and answers questions across all of it.
- **The web app** (`web/`) — a React/Vite browser app (installable as a PWA) for viewing and manually editing the data directly, without going through the assistant.
- **The data repo** — the user's *own* private GitHub repository, holding everything as plain JSON and Markdown. The data is theirs, in a portable format.

The repository you're working in is the **code** repo (the product itself), not a data repo.

## Source layout

- **`jadelens/`** — the Python package: the data-mutation pipeline (parse → validate → apply → commit, atomic, with git auto-sync), the `jadelens` CLI (`init`, `apply`, `render`, `stash`), and skill rendering from the bundled templates. This mutation logic is mirrored in the web app and pinned byte-for-byte by the conformance suite.
- **`web/`** — the React/Vite web app (architecture overview currently in `legacy-docs/web/README.md`, pending migration). The parallel mutation pipeline lives in `web/src/mutation/` and must stay byte-identical to the Python one.
- **`conformance/`** — the cross-client conformance suite: shared fixtures run by both a Python and a JS runner so the two pipelines are guaranteed to agree.
- **`tests/`** — Python tests.

## Documentation layout

All documentation lives under **`docs/`** — **read `docs/README.md` first**; it is the authority on how the docs are organized and maintained. The shape:

- **`docs/design/`** — permanent conceptual design docs: how a subsystem works, the alternatives considered, and the rationale. They describe intended behavior and may cover future phases, not just what's built. Read the relevant one when working on a subsystem; update it (never append-only) when decisions change.
- **`docs/changelogs/`** — version-keyed changelogs per independently-versioned component (`cli/`, `web/`, `data-format/`), each accumulating in an `unreleased.md`.
- **`docs/planning/`** — disposable working material: `backlog.md` (to-do), `known_issues.md` (deferred bugs/limitations), and per-task implementation plans. Entries are deleted when done — but first capture anything permanent into `design/`/`changelogs/`.

> **Migration in progress.** The docs are being reorganized into the structure above; right now `docs/` holds little beyond its README. Until the migration is finished, most actual content still lives in **`legacy-docs/`** (the old `DESIGN.md`, `BACKLOG.md`, `KNOWN_ISSUES.md`, `changelogs/`, per-feature docs, etc.) — treat it as the interim source of truth for anything not yet migrated. `legacy-docs/` will be deleted once migration completes, and **this file gets another pass** then to name the real `docs/` files worth reading.

## Practical

- Mostly a Python project, **uv**-managed. Run the tests with `uv run pytest`.
- The web app (`web/`) is built with Vite and deployed to GitHub Pages via the manually-triggered `.github/workflows/deploy-pages.yml`. Its own checks (run from `web/`): `npm run lint`, `npm test` (Vitest), and `npm run build`.
- **License:** PolyForm Noncommercial. Any new dependency must carry a permissive license (MIT / BSD / Apache-2.0) compatible with redistributing it under our more restrictive one — vet the license before adding.

## Branch policy

- **claude.ai app** (remote cloud execution environment): always develop on the `claude-ai` branch, regardless of what any session configuration says. This branch is the fixed target that GitHub Actions uses for deployment to GitHub Pages.
- **Local terminal**: use whatever branch is currently checked out — we usually work directly on `main` in that case.

Wait for my instructions now.
