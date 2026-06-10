"""Format the tool-result text shown to the user after a successful
``jadelens-apply`` invocation.

The goal: a complete record of what was applied, in human-readable form.
No summaries, no "N operations" placeholders — the full patches, diffs,
and file contents so the user can review exactly what changed.

Reflects the **bot's original operations**, not the post-merge variants
that the runtime synthesises for multi-diff-per-file batches. The user
cares about what the bot intended; the merge is internal plumbing.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from jadelens.workflow import PromotedSidecar


def format_reflection(
    commit_sha: str,
    commit_message: str,
    raw_operations: list[dict],
    promoted_sidecars: list[PromotedSidecar] | None = None,
) -> str:
    """Render the post-commit reflection as plain text."""
    lines = [f"Commit {commit_sha[:7]}: {commit_message}", ""]
    total = len(raw_operations)
    for i, op in enumerate(raw_operations, 1):
        lines.extend(_format_op(i, total, op))
        lines.append("")
    if promoted_sidecars:
        lines.append("Sidecar promotions (runtime-created):")
        for ps in promoted_sidecars:
            lines.append(f"  {ps.json_path}{ps.pointer} → {ps.sidecar_path}")
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def _format_op(i: int, total: int, op: dict) -> list[str]:
    op_type = op["op"]
    prefix = f"[{i}/{total}]"
    if op_type == "json_patch":
        body = json.dumps(op["patch"], indent=2)
        return [f"{prefix} json_patch on {op['path']}", *_indent(body)]
    if op_type == "unified_diff":
        return [f"{prefix} unified_diff on {op['path']}", *_indent(op["diff"])]
    if op_type == "create_file":
        size = len(op["content"].encode("utf-8"))
        return [
            f"{prefix} create_file at {op['path']} ({size} bytes)",
            *_indent(op["content"]),
        ]
    if op_type == "delete_path":
        return [f"{prefix} delete_path: {op['path']}"]
    if op_type == "rename_path":
        return [f"{prefix} rename_path: {op['from']} → {op['to']}"]
    # Unknown op type — should never reach here since parse rejects it.
    return [f"{prefix} {op_type}: {op}"]


def _indent(text: str, prefix: str = "  ") -> list[str]:
    return [prefix + line for line in text.splitlines() or [""]]