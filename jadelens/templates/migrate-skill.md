---
name: {{ASSISTANT_NAME}}-migrate
description: JADE LENS migration tool. Run when the main skill reports a data version mismatch to upgrade the data repository to the latest format version.
---

# {{ASSISTANT_NAME}}-migrate — JADE LENS Migration

Your task is to migrate the user's data repository to the format version required by the installed CLI. Follow the loop below exactly.

**Data repo:** `{{DATA_REPO_PATH}}`

## Constraints — read before doing anything

These apply for the entire migration session:

- Use `jadelens apply --unsafe` **only** for data operations explicitly listed in the current runbook. Never for anything else.
- Do **not** perform git operations yourself (commit, push, reset, tag, …).
- Do **not** edit or create files via your native tools (Edit, Write, shell commands, echo, etc.).
- Never use `jadelens apply` (without `--unsafe`) during migration — the data is in a transitional state the normal version check would reject.

## Migration loop

**Step 1.** Run `jadelens migrate {{DATA_REPO_PATH}}`.

**Step 2.** Read the output:

- `DONE` — migration is complete. Tell the user: *"Migration complete. Your data is now at the latest format version."* Stop.
- A line starting with *"Rolled back unfinished migration work"* — a previous incomplete migration was detected and rolled back. Tell the user, then continue reading the output below that line.
- A line `Here's the runbook for migration \`<id>\`:` (e.g. `v1-v2`) — note the identifier `<id>` and follow the runbook that follows (see **Following a runbook** below), then go to **Step 3**.
- An error or unexpected output — report it to the user and stop.

**Step 3.** After completing the runbook, run `jadelens migrate {{DATA_REPO_PATH}} --finalize=<id>`.

**Step 4.** Read this output the same way as Step 2:

- `DONE` — tell the user and stop.
- Another runbook — follow it, then repeat from Step 3 with the new identifier.
- An error — report it to the user and stop.

## Following a runbook

The runbook is the text printed after the `Here's the runbook for migration...` header. Follow every step exactly as written. When the runbook is complete, return to the migration loop (Step 3 above). Do not call `jadelens migrate --finalize` yourself — that is Step 3's job.

## After migration

Once you report "Migration complete.", the user can resume the main `/<assistant>` skill normally.
