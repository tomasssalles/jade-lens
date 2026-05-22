"""Batch-level orchestration for handle_bot_response.

Pulls together the per-op apply logic into a single atomic transaction:

1. ``validate_batch`` enforces the file-touching rules (no path is touched
   by incompatible op categories in the same batch).
2. ``require_clean_tree`` refuses to proceed if the data repo has
   uncommitted changes — this is what makes the revert-on-failure path
   safe (we never clobber the user's in-flight manual edits).
3. ``merge_unified_diffs`` collapses multiple UnifiedDiff ops on the same
   path into one synthesised diff so the bot can think of all line numbers
   as referencing the pre-batch file state.
4. ``run`` applies each op in order; on any failure it reverts the data
   repo to HEAD (working tree + index + untracked) before re-raising.
5. On success, ``run`` appends one entry to the operations log, then
   commits everything with the bot's commit message. Returns the new SHA.
"""

import json
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from jadelens.operations import (
    ApplyError,
    CreateFile,
    DeletePath,
    JsonPatch,
    Operation,
    RenamePath,
    UnifiedDiff,
    parse_operation,
)
from jadelens.wikilinks import find_references, rewrite_references_under


class WorkflowError(Exception):
    """A workflow-level failure (clean-tree precondition, git plumbing, etc.)."""


class BatchValidationError(Exception):
    """The batch of operations violates a path-touching rule."""


# ---------- Batch validation ----------


def validate_batch(operations: list[Operation]) -> None:
    """Enforce that each path is touched by at most one compatible op-category.

    Categories:
    - ``modify_json``: ``json_patch`` (multiple per path allowed, applied
      sequentially per RFC 6902).
    - ``modify_text``: ``unified_diff`` (multiple per path allowed; merged
      and applied as one synthesised diff against the pre-batch file state).
    - ``structure``: ``create_file``, ``delete_path``, ``rename_path``
      (exactly one per path; rename counts as touching BOTH from and to).

    Mixing categories on the same path raises ``BatchValidationError``.
    Multiple structure ops on the same path also raise.
    """
    entries: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    # entries[path] = list of (op_index, category, op_summary)

    for i, op in enumerate(operations):
        if isinstance(op, JsonPatch):
            entries[op.path].append((i, "modify_json", "json_patch"))
        elif isinstance(op, UnifiedDiff):
            entries[op.path].append((i, "modify_text", "unified_diff"))
        elif isinstance(op, CreateFile):
            entries[op.path].append((i, "structure", "create_file"))
        elif isinstance(op, DeletePath):
            entries[op.path].append((i, "structure", "delete_path"))
        elif isinstance(op, RenamePath):
            entries[op.from_path].append((i, "structure", "rename_path (from)"))
            entries[op.to_path].append((i, "structure", "rename_path (to)"))
        else:
            raise BatchValidationError(
                f"Unknown op type at index {i}: {type(op).__name__}"
            )

    for path, ops_here in entries.items():
        categories = {cat for _, cat, _ in ops_here}
        if len(categories) > 1:
            detail = ", ".join(f"op {i}: {summary}" for i, _, summary in ops_here)
            raise BatchValidationError(
                f"Path {path!r} is touched by incompatible op categories in "
                f"one batch ({detail}). Split into separate batches."
            )
        if next(iter(categories)) == "structure" and len(ops_here) > 1:
            detail = ", ".join(f"op {i}: {summary}" for i, _, summary in ops_here)
            raise BatchValidationError(
                f"Path {path!r} is touched by multiple structure ops in one "
                f"batch ({detail}). Only one of create_file / delete_path / "
                f"rename_path is allowed per path per batch."
            )


# ---------- Unified-diff merging ----------


def merge_unified_diffs(operations: list[Operation]) -> list[Operation]:
    """Combine multiple ``UnifiedDiff`` ops on the same path into one.

    Order is preserved: the merged op replaces the first occurrence on
    that path; subsequent occurrences are dropped. Other op types pass
    through unchanged.

    Assumes ``validate_batch`` has passed, so a path with multiple
    UnifiedDiff ops has no other op-category touching it.
    """
    diffs_by_path: dict[str, list[UnifiedDiff]] = defaultdict(list)
    for op in operations:
        if isinstance(op, UnifiedDiff):
            diffs_by_path[op.path].append(op)

    if all(len(v) == 1 for v in diffs_by_path.values()):
        return operations

    emitted: set[str] = set()
    merged: list[Operation] = []
    for op in operations:
        if isinstance(op, UnifiedDiff) and len(diffs_by_path[op.path]) > 1:
            if op.path in emitted:
                continue
            emitted.add(op.path)
            # rstrip per diff to avoid trailing blank lines between hunks
            # (the parser rejects blank/unknown lines inside a hunk body).
            combined = "\n".join(
                _strip_diff_preamble(d.diff).rstrip("\n")
                for d in diffs_by_path[op.path]
            ) + "\n"
            merged.append(UnifiedDiff(path=op.path, diff=combined))
        else:
            merged.append(op)
    return merged


def _strip_diff_preamble(diff_text: str) -> str:
    """Drop everything before the first ``@@`` line (--- / +++ headers, etc.)."""
    lines = diff_text.split("\n")
    i = 0
    while i < len(lines) and not lines[i].startswith("@@"):
        i += 1
    return "\n".join(lines[i:])


# ---------- Git plumbing ----------


def require_clean_tree(data_repo: Path) -> None:
    """Refuse to proceed if the data repo has uncommitted or untracked changes."""
    try:
        result = subprocess.run(
            ["git", "-C", str(data_repo), "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        raise WorkflowError(
            f"`git status` failed in {data_repo}: {e.stderr.strip()}"
        ) from e
    if result.stdout.strip():
        raise WorkflowError(
            f"Data repo at {data_repo} has uncommitted changes:\n"
            f"{result.stdout.rstrip()}\n"
            f"Commit or stash these before running handle_bot_response."
        )


def revert(data_repo: Path) -> None:
    """Reset the data repo to HEAD and remove any untracked files."""
    try:
        subprocess.run(
            ["git", "-C", str(data_repo), "reset", "--hard", "-q", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(data_repo), "clean", "-fdq"],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        raise WorkflowError(
            f"Failed to revert data repo {data_repo}: {e.stderr.strip()}"
        ) from e


def git_commit(data_repo: Path, message: str) -> str:
    """Stage everything and commit. Returns the new commit SHA."""
    try:
        subprocess.run(
            ["git", "-C", str(data_repo), "add", "-A"],
            capture_output=True,
            text=True,
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(data_repo), "commit", "-q", "-m", message],
            capture_output=True,
            text=True,
            check=True,
        )
        sha = subprocess.run(
            ["git", "-C", str(data_repo), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        raise WorkflowError(
            f"`git commit` failed in {data_repo}: {e.stderr.strip()}"
        ) from e
    return sha.stdout.strip()


# ---------- Log append ----------


LOG_RELATIVE_PATH = Path(".jade") / "operations-log.jsonl"


def append_log_entry(
    data_repo: Path,
    raw_operations: list[dict],
    commit_message: str,
    timestamp: str,
) -> None:
    """Append one JSONL entry to ``.jade/operations-log.jsonl``.

    The commit_message is duplicated here (it's also git's commit message)
    deliberately: it keeps the log self-sufficient as the canonical audit
    record, so a future move off git as the substrate (e.g. to Postgres)
    doesn't lose intent metadata.
    """
    log_path = data_repo / LOG_RELATIVE_PATH
    log_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": timestamp,
        "commit_message": commit_message,
        "operations": raw_operations,
    }
    with log_path.open("a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------- Orchestration ----------


def run(
    data_repo: Path,
    raw_operations: list[dict],
    commit_message: str,
) -> str:
    """Execute the full handle_bot_response workflow.

    Parses ``raw_operations`` into typed ``Operation`` objects, validates
    the batch, ensures the data repo is clean, applies each op, appends a
    log entry, and commits everything with ``commit_message``.

    Returns the new commit SHA on success. On any failure, reverts the data
    repo to its pre-call HEAD and re-raises (``ValidationError``,
    ``BatchValidationError``, ``WorkflowError``, or ``ApplyError``).
    """
    operations = [parse_operation(op) for op in raw_operations]
    validate_batch(operations)
    require_clean_tree(data_repo)
    effective = merge_unified_diffs(operations)

    try:
        for op in effective:
            op.apply(data_repo)
        _post_apply_wikilink_pass(data_repo, effective)
        timestamp = datetime.now(timezone.utc).isoformat()
        append_log_entry(data_repo, raw_operations, commit_message, timestamp)
        return git_commit(data_repo, commit_message)
    except Exception:
        revert(data_repo)
        raise


def _post_apply_wikilink_pass(
    data_repo: Path, operations: list[Operation]
) -> None:
    """Run after every op has applied. For each rename, rewrite remaining
    wikilinks pointing at the old path. For each delete, verify no
    wikilinks still point at the deleted path — if any do, raise.

    Deferring this work to here (rather than doing it inside RenamePath /
    DeletePath ``apply``) lets the bot interleave clean-up ops freely:
    e.g. a ``delete_path foo.md`` followed by a ``unified_diff`` that
    removes the only ``[[foo.md]]`` reference is a valid batch — the
    scan only sees what survived to the end.
    """
    for op in operations:
        if isinstance(op, RenamePath):
            rewrite_references_under(data_repo, op.from_path, op.to_path)
    for op in operations:
        if isinstance(op, DeletePath):
            refs = find_references(data_repo, op.path)
            if refs:
                detail = "; ".join(
                    f"{f.relative_to(data_repo)}: [[{p}]]" for f, p in refs
                )
                raise ApplyError(
                    f"delete_path: {op.path!r} is still referenced by "
                    f"wikilinks after the batch completed — clean these up "
                    f"in the same batch:\n  {detail}"
                )