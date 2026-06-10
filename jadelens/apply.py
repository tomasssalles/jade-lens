"""The data-mutation core behind ``jadelens apply``.

Reads a JSON payload from stdin and hands it to ``workflow.run``, which
parses + validates + applies + commits atomically, then auto-syncs. Prints a
stdout reflection of the applied operations.

Invoked as the ``apply`` subcommand (``jadelens <data_repo> apply``); the CLI
in ``jadelens.cli`` resolves the data-repo path and calls ``do_apply``.

Stdin:
    {
      "commit_message": "...",
      "operations": [ { ... }, ... ]
    }
"""

import json
import sys
from pathlib import Path

from jadelens import sync, workflow
from jadelens.operations import ApplyError, ValidationError
from jadelens.reflection import format_reflection


def do_apply(data_repo: Path) -> None:
    """Read a JSON mutation payload from stdin, apply it atomically, and sync.

    ``data_repo`` is the already-resolved path to the data repo's local clone.
    Pulls the latest remote before applying and pushes the new commit after
    (auto-sync); a cross-device conflict is stashed and reported. Exits with a
    message on malformed input or a workflow failure (the repo is left at HEAD).
    """
    if not data_repo.is_dir():
        sys.exit(f"Data repo path does not exist or is not a directory: {data_repo}")

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        sys.exit(f"Invalid JSON on stdin: {e}")

    if not isinstance(payload, dict):
        sys.exit(f"Payload must be a JSON object, got {type(payload).__name__}")

    commit_message = payload.get("commit_message")
    if not isinstance(commit_message, str) or not commit_message.strip():
        sys.exit("Payload requires non-empty 'commit_message' (string)")

    raw_ops = payload.get("operations")
    if not isinstance(raw_ops, list):
        sys.exit("Payload requires 'operations' (list)")
    if not raw_ops:
        sys.exit("Payload 'operations' must not be empty")

    # Auto-sync, pull side: fetch + fast-forward before applying so the bot's
    # change lands on the latest remote state (docs/sync-and-conflicts.md §2).
    # Best-effort — offline / divergence is left for the push side to reconcile.
    try:
        sync.pull(data_repo)
    except sync.SyncError:
        pass

    try:
        result = workflow.run(data_repo, raw_ops, commit_message)
    except (
        ValidationError,
        workflow.BatchValidationError,
        workflow.WorkflowError,
        ApplyError,
    ) as e:
        sys.exit(f"{type(e).__name__}: {e}")

    print(
        format_reflection(result.sha, commit_message, raw_ops, result.promoted_sidecars),
        end="",
    )

    # Auto-sync, push side: push the new commit; reconcile a remote that advanced
    # under us (rebase if disjoint, stash on a same-file conflict). The change is
    # already committed locally, so a push failure never loses it.
    try:
        result = sync.push(data_repo)
    except sync.SyncError as e:
        print(
            f"\n⚠ Committed locally but could not sync to the remote: {e}\n"
            "  It will sync automatically on the next interaction.",
        )
        return
    if result.action == "stashed":
        print(
            "\n⚠ This change conflicted with a remote edit and was stashed for "
            "review (.jade/stash/). The remote version is now in place and the "
            "working tree has been updated. Use `jadelens stash list` to see it.",
        )