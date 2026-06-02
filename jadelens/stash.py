"""Stash entry construction for the ``/jade`` client (Phase 4 of
docs/mutation-sync-implementation-plan.md; design in docs/sync-and-conflicts.md
§4).

A port of the web app's ``web/src/sync/stash.js`` so both clients write
**byte-identical** stash entries (the Phase 6 cross-client goal): the same
schema, the same JS-canonical serialisation, sorted ancestor keys, and the raw
``{op, path, ...}`` operations verbatim. Pure logic — the git side
(``jadelens.sync``) supplies the pristine ancestor content and writes the file.
"""

import posixpath
import uuid as _uuid
from datetime import datetime, timezone

from jadelens.operations import dumps_js_canonical

STASH_DIR = ".jade/stash"


def _path_and_descendants(prefix: str, paths) -> list[str]:
    """``prefix`` itself plus every path under ``prefix/`` (directory expansion)."""
    return [p for p in paths if p == prefix or p.startswith(prefix + "/")]


def _op_touched_paths(op: dict, paths) -> list[str]:
    """The concrete file paths a single op changes (§3 rename/delete semantics)."""
    kind = op.get("op")
    if kind in ("json_patch", "unified_diff", "create_file"):
        return [op["path"]]
    if kind == "delete_path":
        return _path_and_descendants(op["path"], paths)
    if kind == "rename_path":
        frm, to = op["from"], op["to"]
        sources = _path_and_descendants(frm, paths)
        touched = set(sources) if sources else {frm}
        touched.add(to)
        for p in sources:
            rest = "" if p == frm else p[len(frm):]
            touched.add(to + rest)
        return list(touched)
    return []


def batch_touched_paths(operations: list[dict], paths) -> set[str]:
    """The normalised set of file paths a batch touches (mirrors web's
    ``batchTouchedPaths``). ``paths`` is the known-paths universe for directory
    expansion (pass the pristine base tree's paths)."""
    known = set(paths)
    touched: set[str] = set()
    for op in operations:
        for p in _op_touched_paths(op, known):
            touched.add(posixpath.normpath(p))
    return touched


def build_stash_entry(
    operations: list[dict], timestamp: str, base_content: dict[str, str]
) -> dict:
    """Build the self-contained stash entry for one conflicting batch.

    ``base_content`` MUST be the pristine pre-local-change content (the
    merge-base tree for ``/jade``), keyed by path. Files the batch *creates*
    have no ancestor and are omitted. Ancestor keys are sorted for cross-client
    determinism; operations are kept verbatim.
    """
    touched = batch_touched_paths(operations, base_content.keys())
    ancestors = {p: base_content[p] for p in sorted(touched) if p in base_content}
    return {"timestamp": timestamp, "ancestors": ancestors, "operations": operations}


def serialize_stash_entry(entry: dict) -> str:
    """Serialise to the on-disk form — JS-canonical, byte-identical to the web
    app's ``JSON.stringify(entry, null, 2) + "\\n"``."""
    return dumps_js_canonical(entry)


def compact_timestamp(timestamp: str) -> str:
    """ISO-8601 basic compact form for filenames, e.g. ``20260601T143022Z``.

    Accepts either a ``Z`` or ``+00:00`` suffix and any sub-second precision;
    normalises to UTC, second resolution.
    """
    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def stash_filename(timestamp: str, short_uuid: str | None = None) -> str:
    """The ``.jade/stash/<compactISO>-<shortuuid>.json`` path for an entry."""
    if short_uuid is None:
        short_uuid = _uuid.uuid4().hex[:8]
    return f"{STASH_DIR}/{compact_timestamp(timestamp)}-{short_uuid}.json"


def _count_diff_lines(diff: str) -> int:
    n = 0
    for line in diff.split("\n"):
        if line.startswith("+") and not line.startswith("+++"):
            n += 1
        elif line.startswith("-") and not line.startswith("---"):
            n += 1
    return n


def describe_operation(op: dict) -> str:
    """A short human-readable description of an op (mirrors web's
    ``describeOperation``), for ``jadelens stash list``."""
    kind = op.get("op")
    if kind == "create_file":
        return f"Created {op['path']}"
    if kind == "delete_path":
        return f"Deleted {op['path']}"
    if kind == "rename_path":
        return f"Renamed {op['from']} → {op['to']}"
    if kind == "json_patch":
        n = len(op["patch"]) if isinstance(op.get("patch"), list) else 0
        return f"Modified {op['path']} ({n} JSON change{'' if n == 1 else 's'})"
    if kind == "unified_diff":
        n = _count_diff_lines(op.get("diff", ""))
        return f"Modified {n} line{'' if n == 1 else 's'} in {op['path']}"
    path = op.get("path")
    return f"{kind or 'unknown op'}{f' {path}' if path else ''}"
