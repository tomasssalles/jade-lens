# Migration runbook: v1 → v2

After completing all steps, return control to the migration skill by doing nothing
further — the skill will call `jadelens migrate --finalize=v1-v2` automatically.

---

## Constraints — read before doing anything

- Use `jadelens apply --unsafe` **only** for the data operations explicitly listed
  in this runbook. Do not use it for anything else during this session.
- Do **not** perform any git operations yourself (commit, push, reset, tag, …).
- Do **not** edit or create files directly via your native tools (Edit, Write,
  shell commands, echo, etc.). All data mutations go through
  `jadelens apply --unsafe`; all git operations go through `jadelens migrate`.

---

## Step 1 — Batch-promote inline strings to sidecars

Run the promotion helper. It will scan every JSON file for multi-block string
values and promote them to sidecar files automatically via `apply --unsafe`.

```
jadelens run-migration-helper <data_repo> v1_v2/promote-sidecars
```

Review the output carefully:
- Note the counts (files scanned, values promoted, sidecars created).
- If anything looks unexpected (e.g. a value you would not expect to be
  promoted, or an unusually large number of promotions), stop and report it
  to the user before continuing.
- If the output shows 0 values promoted, that is fine — move on.

---

## Step 2 — Resolve file-stem / directory-name collisions

The v2 rules forbid a file stem from matching a directory name in the same
parent directory (e.g. `Notes.json` and `Notes/` in the same folder).

Check whether any such collision exists. If the data repo is small, a manual
scan is fine; otherwise use your judgment.

For each collision found:
- If the intent is clear (e.g. the directory is a loose collection of files
  that should be merged into the JSON), rename one of the two to resolve the
  conflict using `jadelens apply --unsafe` with a `rename_path` op.
- If the intent is unclear, ask the user before renaming.

If no collisions are found, move on.

---

## Step 3 — Final integrity check

Verify that the data repo passes all v2 structural invariants:

```
jadelens check <data_repo>
```

If the check passes, the runbook is complete. If it fails, address the reported
issue (using `jadelens apply --unsafe` if a data change is needed) and re-run
the check until it passes.
