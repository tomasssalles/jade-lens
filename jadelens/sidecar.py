"""Sidecar promotion: trigger logic and path mapping."""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Any

from markdown_it import MarkdownIt

_md = MarkdownIt()

# Token types that each count as one content block when they appear at document
# level (token.level == 0). List items are counted at any nesting depth.
_BLOCK_OPEN_TYPES_AT_ROOT = frozenset(
    {"paragraph_open", "heading_open", "blockquote_open"}
)


def count_content_blocks(text: str) -> int:
    """Count top-level content blocks in CommonMark text.

    Each paragraph, heading, fenced code block, blockquote, or individual list
    item (at any nesting depth) counts as one block. Returns the total.
    """
    count = 0
    for tok in _md.parse(text):
        if tok.type in _BLOCK_OPEN_TYPES_AT_ROOT and tok.level == 0:
            count += 1
        elif tok.type == "fence" and tok.level == 0:
            count += 1
        elif tok.type == "list_item_open":
            count += 1
    return count


def is_promotable(text: str) -> bool:
    """Return True if *text* should be promoted to a sidecar (> 1 block)."""
    return count_content_blocks(text) > 1


# ---------------------------------------------------------------------------
# JSON Pointer ↔ sidecar filepath mapping
# ---------------------------------------------------------------------------

_SIDECARS_SUFFIX = ".sidecars"


def _unescape_pointer_segment(seg: str) -> str:
    """RFC 6901 unescape: ~1 → /, ~0 → ~ (order matters)."""
    return seg.replace("~1", "/").replace("~0", "~")


def _escape_pointer_segment(seg: str) -> str:
    """RFC 6901 escape: ~ → ~0, / → ~1 (order matters)."""
    return seg.replace("~", "~0").replace("/", "~1")


def pointer_to_sidecar_path(json_path: str, pointer: str) -> str:
    """Derive sidecar filepath from a .json path and RFC 6901 pointer.

    pointer must start with '/' and have at least one segment.

    Examples::

        pointer_to_sidecar_path("Garden.json", "/notes")
        # → "Garden.sidecars/notes.md"

        pointer_to_sidecar_path("Garden.json", "/comparisons/0/description")
        # → "Garden.sidecars/comparisons/0/description.md"

        pointer_to_sidecar_path("a/b/Work.json", "/tasks/2/summary")
        # → "a/b/Work.sidecars/tasks/2/summary.md"
    """
    if not pointer.startswith("/"):
        raise ValueError(f"JSON pointer must start with '/': {pointer!r}")
    segments = [_unescape_pointer_segment(s) for s in pointer[1:].split("/")]
    if not segments or any(s == "" for s in segments):
        raise ValueError(f"Invalid JSON pointer: {pointer!r}")
    p = PurePosixPath(json_path)
    sidecar_dir = p.parent / (p.stem + _SIDECARS_SUFFIX)
    return str(sidecar_dir.joinpath(*segments[:-1], segments[-1] + ".md"))


def json_path_from_sidecar(sidecar_path: str) -> str:
    """Return the .json filepath that owns a sidecar.

    Examples::

        json_path_from_sidecar("Garden.sidecars/notes.md")  # → "Garden.json"
        json_path_from_sidecar("a/Work.sidecars/x/y.md")    # → "a/Work.json"
    """
    parts = PurePosixPath(sidecar_path).parts
    for i, part in enumerate(parts):
        if part.endswith(_SIDECARS_SUFFIX):
            stem = part[: -len(_SIDECARS_SUFFIX)]
            prefix = PurePosixPath(*parts[:i]) if i > 0 else PurePosixPath(".")
            json_p = prefix / (stem + ".json")
            return str(json_p) if i > 0 else stem + ".json"
    raise ValueError(f"No '{_SIDECARS_SUFFIX}' component in path: {sidecar_path!r}")


def sidecar_path_to_pointer(sidecar_path: str, json_data: Any) -> str:
    """Reconstruct the RFC 6901 pointer from a sidecar path and its JSON data.

    Uses the actual JSON structure at each level to distinguish array indices
    (int) from object keys (str), so object key ``"0"`` and array index ``0``
    are unambiguous.

    Args:
        sidecar_path: Repo-relative path to the sidecar .md file.
        json_data: Parsed JSON content of the owning .json file.

    Returns: RFC 6901 pointer string (e.g. ``"/comparisons/0/description"``).

    Raises:
        ValueError: If the path structure is invalid or the pointer cannot be
            resolved against json_data.
    """
    parts = PurePosixPath(sidecar_path).parts
    # Find the .sidecars component
    sidecar_idx = next(
        (i for i, p in enumerate(parts) if p.endswith(_SIDECARS_SUFFIX)), None
    )
    if sidecar_idx is None:
        raise ValueError(f"No '{_SIDECARS_SUFFIX}' component in path: {sidecar_path!r}")

    rel_parts = list(parts[sidecar_idx + 1 :])
    if not rel_parts:
        raise ValueError(f"Sidecar path has no segments after directory: {sidecar_path!r}")
    # Strip .md from the last segment
    last = rel_parts[-1]
    if not last.endswith(".md"):
        raise ValueError(f"Sidecar file does not end in .md: {sidecar_path!r}")
    rel_parts[-1] = last[:-3]

    pointer_segments: list[str] = []
    node: Any = json_data
    for seg in rel_parts:
        if isinstance(node, list):
            try:
                idx = int(seg)
            except ValueError:
                raise ValueError(
                    f"Segment {seg!r} is not an integer but parent is an array"
                ) from None
            if idx < 0 or idx >= len(node):
                raise ValueError(f"Array index {idx} out of range")
            pointer_segments.append(str(idx))
            node = node[idx]
        elif isinstance(node, dict):
            if seg not in node:
                raise ValueError(f"Key {seg!r} not found in JSON object")
            pointer_segments.append(_escape_pointer_segment(seg))
            node = node[seg]
        else:
            raise ValueError(
                f"Cannot traverse into {type(node).__name__} with segment {seg!r}"
            )

    return "/" + "/".join(pointer_segments)
