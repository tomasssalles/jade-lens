"""Batch-level orchestration for jadelens-apply.

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
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from dataclasses import dataclass, field, replace as _dc_replace

from jadelens import __supported_data_format_version__
from jadelens.operations import (
    ApplyError,
    ConformanceError,
    CreateFile,
    DeletePath,
    JsonPatch,
    Operation,
    RenamePath,
    UnifiedDiff,
    dumps_js_canonical,
    dumps_js_canonical_compact,
    parse_operation,
)
from jadelens.sidecar import (
    is_promotable,
    json_path_from_sidecar,
    pointer_to_sidecar_path,
    sidecar_dir_for_json,
    sidecar_path_to_pointer,
)
from jadelens.wikilinks import WIKILINK_RE, find_dead_wikilinks, rewrite_references_under


@dataclass
class PromotedSidecar:
    """Metadata about a sidecar file created automatically by the promotion pass."""

    sidecar_path: str  # e.g. "Garden.sidecars/notes.md"
    json_path: str     # owning JSON file, e.g. "Garden.json"
    pointer: str       # resolved RFC 6901 pointer, e.g. "/notes"


@dataclass
class RunResult:
    """Return value of :func:`run`."""

    sha: str
    promoted_sidecars: list[PromotedSidecar] = field(default_factory=list)


class WorkflowError(Exception):
    """A workflow-level failure (clean-tree precondition, git plumbing, etc.)."""


class BatchValidationError(ConformanceError):
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
                f"Unknown op type at index {i}: {type(op).__name__}",
                code="OP_UNKNOWN_TYPE",
            )

    for path, ops_here in entries.items():
        categories = {cat for _, cat, _ in ops_here}
        if len(categories) > 1:
            detail = ", ".join(f"op {i}: {summary}" for i, _, summary in ops_here)
            raise BatchValidationError(
                f"Path {path!r} is touched by incompatible op categories in "
                f"one batch ({detail}). Split into separate batches.",
                code="BATCH_INCOMPATIBLE_CATEGORIES",
            )
        if next(iter(categories)) == "structure" and len(ops_here) > 1:
            detail = ", ".join(f"op {i}: {summary}" for i, _, summary in ops_here)
            raise BatchValidationError(
                f"Path {path!r} is touched by multiple structure ops in one "
                f"batch ({detail}). Only one of create_file / delete_path / "
                f"rename_path is allowed per path per batch.",
                code="BATCH_MULTIPLE_STRUCTURE_OPS",
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
            combined = (
                "\n".join(
                    _strip_diff_preamble(d.diff).rstrip("\n")
                    for d in diffs_by_path[op.path]
                )
                + "\n"
            )
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
            f"Commit or stash these before running jadelens-apply."
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


def _log_path(data_repo: Path) -> Path:
    """Return the path to the current data-version's operations log file.

    The log is partitioned by data-format version: each migration starts a
    fresh ``.jade/operations-log/<version>.jsonl`` file so pre-migration
    entries (which reference data shapes that may no longer exist) stay
    readable but separate from post-migration ones (§7.2, §14.5).
    """
    version = __supported_data_format_version__
    return data_repo / ".jade" / "operations-log" / f"{version}.jsonl"


def append_log_entry(
    data_repo: Path,
    raw_operations: list[dict],
    commit_message: str,
    timestamp: str,
) -> None:
    """Append one JSONL entry to the current version's operations log.

    The commit_message is duplicated here (it's also git's commit message)
    deliberately: it keeps the log self-sufficient as the canonical audit
    record, so a future move off git as the substrate (e.g. to Postgres)
    doesn't lose intent metadata.
    """
    log_path = _log_path(data_repo)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": timestamp,
        "commit_message": commit_message,
        "operations": raw_operations,
    }
    with log_path.open("a") as f:
        f.write(dumps_js_canonical_compact(entry) + "\n")


# ---------- Orchestration ----------


def run(
    data_repo: Path,
    raw_operations: list[dict],
    commit_message: str,
) -> RunResult:
    """Execute the full jadelens-apply workflow.

    Parses ``raw_operations`` into typed ``Operation`` objects, validates
    the batch, ensures the data repo is clean, applies each op, appends a
    log entry, and commits everything with ``commit_message``.

    Returns a :class:`RunResult` with the new commit SHA and metadata about
    any sidecars the promotion pass created. On any failure, reverts the data
    repo to its pre-call HEAD and re-raises (``ValidationError``,
    ``BatchValidationError``, ``WorkflowError``, or ``ApplyError``).
    """
    operations = [parse_operation(op) for op in raw_operations]
    validate_batch(operations)
    require_clean_tree(data_repo)
    effective = merge_unified_diffs(operations)

    try:
        effective, sidecar_records = _pre_apply_sidecar_promotion_pass(data_repo, effective)
        for sidecar_path, content, _json_path, _pointer in sidecar_records:
            full = data_repo / sidecar_path
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(content)
        for op in effective:
            op.apply(data_repo)
        _post_apply_sidecar_propagation_pass(data_repo, effective)
        _post_apply_wikilink_pass(data_repo, effective)
        _post_apply_index_pass(data_repo, effective)
        _post_apply_enforcement_pass(data_repo)
        timestamp = datetime.now(timezone.utc).isoformat()
        append_log_entry(data_repo, raw_operations, commit_message, timestamp)
        sha = git_commit(data_repo, commit_message)
        promoted = [
            PromotedSidecar(sidecar_path=sp, json_path=jp, pointer=ptr)
            for sp, _content, jp, ptr in sidecar_records
        ]
        return RunResult(sha=sha, promoted_sidecars=promoted)
    except Exception:
        revert(data_repo)
        raise


def _resolve_json_pointer(pointer: str, data: object) -> str:
    """Resolve '/-' array-append tokens to concrete indices using *data*."""
    if not pointer.startswith("/"):
        return pointer
    segments = pointer[1:].split("/")
    resolved: list[str] = []
    node: object = data
    for seg in segments:
        if seg == "-" and isinstance(node, list):
            resolved.append(str(len(node)))
            node = None
        else:
            # RFC 6901 unescape for traversal
            key = seg.replace("~1", "/").replace("~0", "~")
            resolved.append(seg)  # keep escaped form in output pointer
            if isinstance(node, list):
                try:
                    node = node[int(key)]
                except (ValueError, IndexError):
                    node = None
            elif isinstance(node, dict):
                node = node.get(key)
            else:
                node = None
    return "/" + "/".join(resolved)


def _pre_apply_sidecar_promotion_pass(
    data_repo: Path, operations: list[Operation]
) -> tuple[list[Operation], list[tuple[str, str, str, str]]]:
    """Scan json_patch ops and promote promotable string values to sidecars.

    For each ``add``/``replace`` patch op whose value is a promotable string
    (and not already a wikilink), derive the sidecar path, rewrite the patch
    value to the wikilink, and collect the sidecar content.

    Returns ``(modified_ops, [(sidecar_path, content, json_path, pointer), ...])``.
    Callers write the sidecar files before applying the modified ops.
    """
    new_ops: list[Operation] = []
    new_sidecars: list[tuple[str, str, str, str]] = []

    for op in operations:
        if isinstance(op, JsonPatch):
            json_file = data_repo / op.path
            try:
                current: object = (
                    json.loads(json_file.read_text()) if json_file.exists() else None
                )
            except (json.JSONDecodeError, OSError):
                current = None

            new_patch = list(op.patch)
            changed = False
            for j, patch_op in enumerate(new_patch):
                if patch_op.get("op") not in ("add", "replace"):
                    continue
                value = patch_op.get("value")
                if not isinstance(value, str):
                    continue
                if value.startswith("[[") and value.endswith("]]"):
                    continue  # already a wikilink
                if not is_promotable(value):
                    continue

                pointer = patch_op.get("path", "")
                resolved = (
                    _resolve_json_pointer(pointer, current)
                    if current is not None
                    else pointer
                )
                try:
                    sidecar_path = pointer_to_sidecar_path(op.path, resolved)
                except ValueError:
                    continue

                new_patch[j] = {**patch_op, "value": f"[[{sidecar_path}]]"}
                new_sidecars.append((sidecar_path, value, op.path, resolved))
                changed = True

            if changed:
                op = _dc_replace(op, patch=new_patch)

        new_ops.append(op)

    return new_ops, new_sidecars


def _post_apply_sidecar_propagation_pass(
    data_repo: Path, operations: list[Operation]
) -> None:
    """Propagate sidecar side-effects for structural ops.

    6a: When rename_path renames <stem>.json → <new_stem>.json, also rename
        <stem>.sidecars/ → <new_stem>.sidecars/ (if it exists) and rewrite
        all wikilinks pointing into the old sidecar directory.
    6b: When delete_path deletes <stem>.json, also delete <stem>.sidecars/
        (if it exists). Sidecar wikilinks are forbidden outside the owning
        field, so no dangling reference can block this.
    6c: When a json_patch contains a ``move`` sub-op, rename the sidecar
        file (and any nested sidecar subtree) from the source pointer's
        path to the destination pointer's path.
    """
    for op in operations:
        # 6b
        if isinstance(op, DeletePath) and op.path.endswith(".json"):
            sidecar_dir = sidecar_dir_for_json(op.path)
            if (data_repo / sidecar_dir).is_dir():
                try:
                    subprocess.run(
                        ["git", "-C", str(data_repo), "rm", "-r", "--force", "--",
                         sidecar_dir],
                        capture_output=True, text=True, check=True,
                    )
                except subprocess.CalledProcessError as e:
                    raise ApplyError(
                        f"Failed to delete sidecar directory {sidecar_dir!r}: "
                        f"{e.stderr.strip()}"
                    ) from e

        if isinstance(op, RenamePath) and op.from_path.endswith(".json"):
            from_sidecar_dir = sidecar_dir_for_json(op.from_path)
            to_sidecar_dir = sidecar_dir_for_json(op.to_path)
            if not (data_repo / from_sidecar_dir).is_dir():
                continue
            (data_repo / to_sidecar_dir).parent.mkdir(parents=True, exist_ok=True)
            try:
                subprocess.run(
                    ["git", "-C", str(data_repo), "mv", "--",
                     from_sidecar_dir, to_sidecar_dir],
                    capture_output=True, text=True, check=True,
                )
            except subprocess.CalledProcessError as e:
                raise ApplyError(
                    f"Failed to rename sidecar directory {from_sidecar_dir!r} → "
                    f"{to_sidecar_dir!r}: {e.stderr.strip()}"
                ) from e
            rewrite_references_under(data_repo, from_sidecar_dir, to_sidecar_dir)

        # 6c
        if isinstance(op, JsonPatch):
            for patch_op in op.patch:
                if patch_op.get("op") != "move":
                    continue
                from_ptr = patch_op.get("from", "")
                to_ptr = patch_op.get("path", "")
                if not from_ptr.startswith("/") or not to_ptr.startswith("/"):
                    continue
                # Skip /-: array-append is undefined as a move source/target
                if "-" in from_ptr[1:].split("/") or "-" in to_ptr[1:].split("/"):
                    continue
                try:
                    from_sidecar = pointer_to_sidecar_path(op.path, from_ptr)
                    to_sidecar = pointer_to_sidecar_path(op.path, to_ptr)
                except ValueError:
                    continue
                if from_sidecar == to_sidecar:
                    continue
                from_base = from_sidecar[:-3]  # strip .md suffix
                to_base = to_sidecar[:-3]
                # Move the .md sidecar file (--force handles existing target)
                if (data_repo / from_sidecar).is_file():
                    (data_repo / to_sidecar).parent.mkdir(parents=True, exist_ok=True)
                    try:
                        subprocess.run(
                            ["git", "-C", str(data_repo), "mv", "--force", "--",
                             from_sidecar, to_sidecar],
                            capture_output=True, text=True, check=True,
                        )
                    except subprocess.CalledProcessError as e:
                        raise ApplyError(
                            f"Failed to move sidecar {from_sidecar!r} → "
                            f"{to_sidecar!r}: {e.stderr.strip()}"
                        ) from e
                    rewrite_references_under(data_repo, from_sidecar, to_sidecar)
                # Move nested sidecar subtree (object/array fields)
                if (data_repo / from_base).is_dir() and not (data_repo / to_base).exists():
                    (data_repo / to_base).parent.mkdir(parents=True, exist_ok=True)
                    try:
                        subprocess.run(
                            ["git", "-C", str(data_repo), "mv", "--",
                             from_base, to_base],
                            capture_output=True, text=True, check=True,
                        )
                    except subprocess.CalledProcessError as e:
                        raise ApplyError(
                            f"Failed to move sidecar subtree {from_base!r} → "
                            f"{to_base!r}: {e.stderr.strip()}"
                        ) from e
                    rewrite_references_under(data_repo, from_base, to_base)


def _post_apply_index_pass(data_repo: Path, operations: list[Operation]) -> None:
    """Run after every op and the wikilink pass have completed.

    For each ``create_file`` op that has ``indexed=True``, append an entry to
    ``Index.json``. Running this as a post-apply pass (rather than inside
    ``CreateFile.apply``) keeps the five operation types pure: their
    ``apply`` methods only perform the single structural change described by
    the operation. Runtime automations like this one happen here, after all
    ops have landed, and are therefore never recorded in the operations log.
    """
    for op in operations:
        if isinstance(op, CreateFile) and op.indexed:
            _append_index_entry(data_repo, op.path, op.scope)  # type: ignore[arg-type]


def _append_index_entry(data_repo: Path, path: str, scope: str) -> None:
    """Append ``{"File": "[[<path>]]", "Scope": "<scope>"}`` to ``Index.json``.

    Creates ``Index.json`` if absent. If the file exists but is not a JSON
    array, treats it as empty (defensive; should not occur in a healthy repo).
    """
    index_path = data_repo / "Index.json"
    normalized = str(PurePosixPath(path))
    entry = {"File": f"[[{normalized}]]", "Scope": scope}
    if index_path.exists():
        try:
            parsed = json.loads(index_path.read_text())
            entries: list = parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            entries = []
    else:
        entries = []
    entries.append(entry)
    index_path.write_text(dumps_js_canonical(entries))


def _post_apply_wikilink_pass(data_repo: Path, operations: list[Operation]) -> None:
    """Rewrite wikilinks after renames.

    For each ``rename_path``, rewrite every wikilink in the repo pointing at
    the old path so it points at the new location. Runs against the end-state
    so the bot can freely interleave rename and cleanup ops in any order.
    Dead-wikilink checking (including after deletes) is handled by the
    subsequent enforcement pass.
    """
    for op in operations:
        if isinstance(op, RenamePath):
            rewrite_references_under(data_repo, op.from_path, op.to_path)


# ---------- Post-apply enforcement pass ----------

_INDEX_ENTRY_WIKILINK_RE = re.compile(r"^\[\[(.+)\]\]$")
_INDEX_EXCLUDED_PATHS = frozenset({"Index.json", "CLAUDE.md"})
_SIDECARS_SUFFIX = ".sidecars"


def _is_sidecar_path(path: str) -> bool:
    """Return True if *path* is inside a .sidecars directory."""
    return any(part.endswith(_SIDECARS_SUFFIX) for part in PurePosixPath(path).parts)


def _post_apply_enforcement_pass(data_repo: Path) -> None:
    """Format, completeness, and integrity checks after all ops and automation
    passes have completed. Any failure reverts the entire batch.

    4a — Index.json format: a JSON array; each entry an object with 'File'
         (a ``[[wikilink]]``) and a non-empty 'Scope' string; no entry may
         reference an excluded path.
    4b — No file stem equals a directory name in the same parent anywhere in
         the repo (would cause UI collisions when extensions are stripped).
    4c — No duplicate 'File' values in Index.json.
    4d — Every non-excluded file has an index entry (only enforced when
         Index.json exists).
    4e — Every wikilink in every file resolves to an existing file.
    5f-i   — Every .sidecars/ directory has a matching .json owner.
    5f-ii  — Files inside .sidecars/ directories must end with .md.
    5f-iii — Each sidecar .md's owning JSON field holds exactly the wikilink.
    5f-iv  — Sidecar wikilinks appear only at their owning JSON field.
    """
    result = subprocess.run(
        ["git", "-C", str(data_repo), "ls-files",
         "--cached", "--others", "--exclude-standard"],
        capture_output=True, text=True, check=True,
    )
    all_relative = [p for p in result.stdout.splitlines() if p]
    user_relative = [
        p for p in all_relative
        if not PurePosixPath(p).parts[0].startswith(".")
        and not _is_sidecar_path(p)
    ]

    index_entries = _enforce_index_format(data_repo)
    entries = index_entries if index_entries is not None else []
    _enforce_index_no_duplicates(entries)
    _enforce_index_completeness(user_relative, entries)

    _enforce_no_stem_dir_collision(user_relative)

    _enforce_sidecar_owner_exists(all_relative)
    _enforce_sidecar_only_md(all_relative)
    _enforce_sidecar_integrity(data_repo, all_relative)

    dead = find_dead_wikilinks(data_repo)
    if dead:
        detail = "; ".join(
            f"{f.relative_to(data_repo)}: [[{p}]]" for f, p in dead
        )
        raise ApplyError(
            f"Wikilinks resolve to nonexistent files:\n  {detail}",
            code="WIKILINK_DEAD",
        )


def _enforce_sidecar_owner_exists(all_relative: list[str]) -> None:
    """5f-i: Every .sidecars/ directory must have a matching .json owner."""
    all_paths = set(all_relative)
    checked: set[str] = set()
    for path in all_relative:
        if not _is_sidecar_path(path):
            continue
        try:
            json_path = json_path_from_sidecar(path)
        except ValueError:
            continue
        if json_path in checked:
            continue
        checked.add(json_path)
        if json_path not in all_paths:
            raise ApplyError(
                f"Sidecar path {path!r} requires {json_path!r} to exist, but it does not",
                code="SIDECAR_OWNER_MISSING",
            )


def _enforce_sidecar_only_md(all_relative: list[str]) -> None:
    """5f-ii: Files inside .sidecars/ directories must all end with .md."""
    for path in all_relative:
        if _is_sidecar_path(path) and not path.endswith(".md"):
            raise ApplyError(
                f"Non-.md file inside a sidecar directory: {path!r}",
                code="SIDECAR_NON_MD_FILE",
            )


def _get_at_json_pointer(data: object, pointer: str) -> object | None:
    """Return the value at *pointer* in *data*, or None if unreachable."""
    node = data
    for seg in pointer[1:].split("/"):
        key = seg.replace("~1", "/").replace("~0", "~")
        if isinstance(node, list):
            try:
                node = node[int(key)]
            except (ValueError, IndexError):
                return None
        elif isinstance(node, dict):
            if key not in node:
                return None
            node = node[key]
        else:
            return None
    return node


def _enforce_sidecar_integrity(data_repo: Path, all_relative: list[str]) -> None:
    """5f-iii + 5f-iv: Each sidecar .md's owning JSON field must hold its
    wikilink, and no other file (or field) may reference that wikilink."""
    sidecar_paths = [
        p for p in all_relative if _is_sidecar_path(p) and p.endswith(".md")
    ]
    sidecar_path_set = set(sidecar_paths)

    # 5f-iii: each sidecar has the right wikilink at the correct JSON field
    owner_data_cache: dict[str, object | None] = {}

    def _load_owner(json_path: str) -> object | None:
        if json_path not in owner_data_cache:
            f = data_repo / json_path
            try:
                owner_data_cache[json_path] = json.loads(f.read_text()) if f.exists() else None
            except (json.JSONDecodeError, OSError):
                owner_data_cache[json_path] = None
        return owner_data_cache[json_path]

    for sidecar_path in sidecar_paths:
        json_path = json_path_from_sidecar(sidecar_path)
        data = _load_owner(json_path)
        if data is None:
            continue  # already caught by 5f-i

        try:
            pointer = sidecar_path_to_pointer(sidecar_path, data)
        except ValueError as e:
            raise ApplyError(
                f"Sidecar {sidecar_path!r} has no corresponding field in "
                f"{json_path!r}: {e}",
                code="SIDECAR_FIELD_MISSING",
            ) from e

        actual = _get_at_json_pointer(data, pointer)
        expected = f"[[{sidecar_path}]]"
        if actual != expected:
            raise ApplyError(
                f"Sidecar {sidecar_path!r}: {json_path!r} at {pointer!r} must be "
                f"{expected!r}, found {actual!r}",
                code="SIDECAR_WIKILINK_MISSING",
            )

    # 5f-iv: sidecar wikilinks appear only in their owning JSON file, once
    occurrences: dict[str, int] = {}
    scannable_suffixes = (".json", ".md")
    for rel in all_relative:
        if not any(rel.endswith(s) for s in scannable_suffixes):
            continue
        f = data_repo / rel
        if not f.is_file():
            continue
        for link_path in WIKILINK_RE.findall(f.read_text()):
            if link_path not in sidecar_path_set:
                continue
            owner = json_path_from_sidecar(link_path)
            if rel != owner:
                raise ApplyError(
                    f"Sidecar wikilink [[{link_path}]] found in {rel!r}; "
                    f"only {owner!r} may reference it",
                    code="SIDECAR_WIKILINK_WRONG_FILE",
                )
            occurrences[link_path] = occurrences.get(link_path, 0) + 1

    for sidecar_path, count in occurrences.items():
        if count > 1:
            owner = json_path_from_sidecar(sidecar_path)
            raise ApplyError(
                f"Sidecar wikilink [[{sidecar_path}]] appears {count} times in "
                f"{owner!r}; only one occurrence is allowed",
                code="SIDECAR_WIKILINK_DUPLICATE",
            )


def _enforce_index_format(data_repo: Path) -> list[dict] | None:
    """Load and validate Index.json format. Returns entries or None if absent."""
    index_path = data_repo / "Index.json"
    if not index_path.exists():
        return None
    try:
        parsed = json.loads(index_path.read_text())
    except json.JSONDecodeError as e:
        raise ApplyError(f"Index.json is not valid JSON: {e}", code="INDEX_MALFORMED")
    if not isinstance(parsed, list):
        raise ApplyError("Index.json must be a JSON array", code="INDEX_MALFORMED")
    for i, entry in enumerate(parsed):
        if not isinstance(entry, dict):
            raise ApplyError(
                f"Index.json entry {i} is not an object", code="INDEX_MALFORMED"
            )
        file_val = entry.get("File")
        if not isinstance(file_val, str):
            raise ApplyError(
                f"Index.json entry {i}: 'File' must be a string", code="INDEX_MALFORMED"
            )
        m = _INDEX_ENTRY_WIKILINK_RE.match(file_val)
        if not m:
            raise ApplyError(
                f"Index.json entry {i}: 'File' must be a wikilink [[...]], "
                f"got {file_val!r}",
                code="INDEX_MALFORMED",
            )
        linked_path = m.group(1)
        linked_parts = PurePosixPath(linked_path).parts
        if linked_parts and linked_parts[0].startswith("."):
            raise ApplyError(
                f"Index.json entry {i}: 'File' {file_val!r} references a "
                f"protected path; excluded paths cannot be indexed",
                code="INDEX_MALFORMED",
            )
        if linked_path in _INDEX_EXCLUDED_PATHS or _is_sidecar_path(linked_path):
            raise ApplyError(
                f"Index.json entry {i}: 'File' {file_val!r} is not allowed "
                f"in the index",
                code="INDEX_MALFORMED",
            )
        scope_val = entry.get("Scope")
        if not isinstance(scope_val, str) or not scope_val.strip():
            raise ApplyError(
                f"Index.json entry {i}: 'Scope' must be a non-empty string",
                code="INDEX_MALFORMED",
            )
    return parsed


def _enforce_index_no_duplicates(entries: list[dict]) -> None:
    seen: set[str] = set()
    for entry in entries:
        file_val = entry["File"]
        if file_val in seen:
            raise ApplyError(
                f"Index.json has duplicate File entry: {file_val!r}",
                code="INDEX_DUPLICATE_FILE",
            )
        seen.add(file_val)


def _enforce_index_completeness(
    user_relative: list[str], entries: list[dict]
) -> None:
    """Every non-excluded user file must appear in Index.json."""
    indexed_paths: set[str] = set()
    for entry in entries:
        m = _INDEX_ENTRY_WIKILINK_RE.match(entry["File"])
        if m:
            indexed_paths.add(str(PurePosixPath(m.group(1))))
    for rel in user_relative:
        path_str = str(PurePosixPath(rel))
        if path_str in _INDEX_EXCLUDED_PATHS:
            continue
        if path_str not in indexed_paths:
            raise ApplyError(
                f"File {rel!r} is not listed in Index.json",
                code="INDEX_MISSING_ENTRY",
            )


def _enforce_no_stem_dir_collision(user_relative: list[str]) -> None:
    """No file stem may equal a directory name in the same parent directory."""
    parent_file_stems: dict[str, set[str]] = defaultdict(set)
    parent_dir_names: dict[str, set[str]] = defaultdict(set)

    for rel in user_relative:
        p = PurePosixPath(rel)
        parts = p.parts
        parent_file_stems[str(p.parent)].add(p.stem)
        for i in range(len(parts) - 1):
            dir_name = parts[i]
            grandparent = str(PurePosixPath(*parts[:i])) if i > 0 else "."
            parent_dir_names[grandparent].add(dir_name)

    for parent_str in set(parent_file_stems) | set(parent_dir_names):
        stems = parent_file_stems.get(parent_str, set())
        dirs = parent_dir_names.get(parent_str, set())
        collision = stems & dirs
        if collision:
            raise ApplyError(
                f"File stem collides with directory name in "
                f"{parent_str!r}: {sorted(collision)}",
                code="STEM_DIR_COLLISION",
            )
