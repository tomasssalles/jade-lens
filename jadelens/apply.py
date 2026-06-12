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

from jadelens import __version__, sync, workflow
from jadelens.operations import ApplyError, ValidationError
from jadelens.reflection import format_reflection
from jadelens.skill import parse_skill_marker_version


def do_apply(data_repo: Path, *, unsafe: bool = False) -> None:
    """Read a JSON mutation payload from stdin, apply it atomically, and sync.

    ``data_repo`` is the already-resolved path to the data repo's local clone.
    Pulls the latest remote before applying and pushes the new commit after
    (auto-sync); a cross-device conflict is stashed and reported. Exits with a
    message on malformed input or a workflow failure (the repo is left at HEAD).

    When ``unsafe=True``, the version check and enforcement pass are skipped,
    and the push step is omitted (the caller is responsible for pushing).
    """
    if not data_repo.is_dir():
        sys.exit(f"Data repo path does not exist or is not a directory: {data_repo}")

    # Version guard: the rendered skill must match the installed CLI.
    # A mismatch means either the CLI was updated without running post-update,
    # or another device ran jadelens update and this device's CLI is stale.
    marker_version = parse_skill_marker_version(data_repo)
    if marker_version is not None and marker_version != __version__:
        if marker_version < __version__:
            sys.exit(
                f"Installed CLI version {__version__!r} is ahead of skill version "
                f"{marker_version!r}.\n"
                f"Run 'jadelens post-update --data-repo={data_repo}' to finish the "
                "update, then retry."
            )
        else:
            sys.exit(
                f"Skill version {marker_version!r} is ahead of installed CLI version "
                f"{__version__!r}.\n"
                "Run 'jadelens update' to update the CLI, then retry."
            )

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
        result = workflow.run(data_repo, raw_ops, commit_message, unsafe=unsafe)
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

    # In unsafe (migration) mode, leave pushing to `jadelens migrate --finalize`.
    if unsafe:
        return

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