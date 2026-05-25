# JADE LENS -- AI personal assistant

This project has a very detailed design document `./DESIGN.md`, which you should read. The design does not correspond to what is being built at the moment, but rather works as a vision of where the project is headed in the future. For the current WIP details, take a look at the latest file `./changelogs/<version>.md` (latest = highest version), which you should also read. Finally, there may or may not be a file `./next_steps.md` (gitignored), and if it's present, you should read it.

When I say "catch up", read the files I mentioned above, as well as any memories you have about this project, and then wait for further instructions (no need to recap and summarize everything, just let me know when you're done).

These 3 files are meant to (among other things) bring you up to speed when a new session begins. It's therefore important to also keep them up-to-date for future sessions.

The project has a PolyForm Noncommercial License. This means we have to be careful when adding new dependencies (they must have very permissive licenses that allow us to use them while adding our more restrictive license).

This is mostly a Python project, uv-managed. Call `uv run pytest` for tests. The `./web` subdirectory is a React web-app built with Vite and deployed to github pages by running the workflow at `.github/workflows/deploy-pages.yml` (manually triggered).

The development branch for Claude Code sessions is `claude-ai`. Always commit and push to that branch.

Wait for my instructions now.