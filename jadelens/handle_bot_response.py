"""Python entry point for the ``handle_bot_response`` tool.

Reads a JSON payload from stdin and hands it to ``workflow.run``, which
parses + validates + applies + commits atomically. Prints a stdout
reflection of the applied operations (task 22).

CLI:
    handle_bot_response <data_repo_path>

Stdin:
    {
      "commit_message": "...",
      "operations": [ { ... }, ... ]
    }
"""

import json
import sys
from pathlib import Path

from jadelens import workflow
from jadelens.operations import ApplyError, ValidationError
from jadelens.reflection import format_reflection


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: handle_bot_response <data_repo_path>")
    data_repo = Path(sys.argv[1]).resolve()
    if not data_repo.is_dir():
        sys.exit(f"Data repo path does not exist or is not a directory: {data_repo}")

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        sys.exit(f"Invalid JSON on stdin: {e}")

    if not isinstance(payload, dict):
        sys.exit(
            f"Payload must be a JSON object, got {type(payload).__name__}"
        )

    commit_message = payload.get("commit_message")
    if not isinstance(commit_message, str) or not commit_message.strip():
        sys.exit("Payload requires non-empty 'commit_message' (string)")

    raw_ops = payload.get("operations")
    if not isinstance(raw_ops, list):
        sys.exit("Payload requires 'operations' (list)")
    if not raw_ops:
        sys.exit("Payload 'operations' must not be empty")

    try:
        commit_sha = workflow.run(data_repo, raw_ops, commit_message)
    except (
        ValidationError,
        workflow.BatchValidationError,
        workflow.WorkflowError,
        ApplyError,
    ) as e:
        sys.exit(f"{type(e).__name__}: {e}")

    print(format_reflection(commit_sha, commit_message, raw_ops), end="")


if __name__ == "__main__":
    main()