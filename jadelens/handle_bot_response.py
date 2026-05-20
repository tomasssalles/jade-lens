"""Python entry point for the ``handle_bot_response`` tool.

Reads a JSON payload from stdin, validates it, and (in later iterations)
applies the operations to the data repo, appends a log entry, and commits.

Task 17 scaffold: parse + validate + print a stub line per op. Real apply
and workflow logic land in subsequent tasks.

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

from jadelens.operations import ValidationError, parse_operation


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
        operations = [parse_operation(op) for op in raw_ops]
    except ValidationError as e:
        sys.exit(f"Operation validation failed: {e}")

    # Stub: announce what would happen. Real apply lands in task 18+.
    print(f"Would apply {len(operations)} operation(s) to {data_repo}")
    print(f"Commit message: {commit_message}")
    for i, op in enumerate(operations, 1):
        print(f"  [{i}] {type(op).__name__}: {op}")


if __name__ == "__main__":
    main()