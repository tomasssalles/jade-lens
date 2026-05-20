"""Typed operation classes for handle_bot_response.

Each ``Operation`` knows its inputs after structural validation. ``apply``
methods are stubs at this point — they're filled in by subsequent
implementation steps (create/delete/rename, then json_patch, then
unified_diff).
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ValidationError(Exception):
    """A bot-emitted operation failed structural validation."""


@dataclass(slots=True, frozen=True)
class CreateFile:
    path: str
    content: str

    def apply(self, data_repo: Path) -> None:
        raise NotImplementedError


@dataclass(slots=True, frozen=True)
class DeletePath:
    """Recursive delete of a file or directory (``git rm -r``)."""

    path: str

    def apply(self, data_repo: Path) -> None:
        raise NotImplementedError


@dataclass(slots=True, frozen=True)
class RenamePath:
    from_path: str
    to_path: str

    def apply(self, data_repo: Path) -> None:
        raise NotImplementedError


@dataclass(slots=True, frozen=True)
class JsonPatch:
    path: str
    patch: list[dict[str, Any]]

    def apply(self, data_repo: Path) -> None:
        raise NotImplementedError


@dataclass(slots=True, frozen=True)
class UnifiedDiff:
    path: str
    diff: str

    def apply(self, data_repo: Path) -> None:
        raise NotImplementedError


Operation = CreateFile | DeletePath | RenamePath | JsonPatch | UnifiedDiff


def parse_operation(raw: Any) -> Operation:
    """Validate and parse a raw operation dict into a typed ``Operation``.

    Raises ``ValidationError`` with an informative message for any failure
    (missing/unknown/wrong-typed fields, unknown op type, etc.).
    """
    if not isinstance(raw, dict):
        raise ValidationError(
            f"Operation must be a JSON object, got {type(raw).__name__}"
        )
    op_type = raw.get("op")
    if op_type is None:
        raise ValidationError("Operation missing 'op' field")

    parsers = {
        "create_file": _parse_create_file,
        "delete_path": _parse_delete_path,
        "rename_path": _parse_rename_path,
        "json_patch": _parse_json_patch,
        "unified_diff": _parse_unified_diff,
    }
    parser = parsers.get(op_type)
    if parser is None:
        raise ValidationError(
            f"Unknown op type {op_type!r}. Allowed: {sorted(parsers)}"
        )
    return parser(raw)


def _parse_create_file(raw: dict) -> CreateFile:
    _require_exact_keys(raw, {"op", "path", "content"})
    return CreateFile(
        path=_require_str(raw, "path"),
        content=_require_str(raw, "content"),
    )


def _parse_delete_path(raw: dict) -> DeletePath:
    _require_exact_keys(raw, {"op", "path"})
    return DeletePath(path=_require_str(raw, "path"))


def _parse_rename_path(raw: dict) -> RenamePath:
    _require_exact_keys(raw, {"op", "from", "to"})
    return RenamePath(
        from_path=_require_str(raw, "from"),
        to_path=_require_str(raw, "to"),
    )


def _parse_json_patch(raw: dict) -> JsonPatch:
    _require_exact_keys(raw, {"op", "path", "patch"})
    patch = raw["patch"]
    if not isinstance(patch, list):
        raise ValidationError(
            f"json_patch 'patch' must be a list, got {type(patch).__name__}"
        )
    return JsonPatch(path=_require_str(raw, "path"), patch=patch)


def _parse_unified_diff(raw: dict) -> UnifiedDiff:
    _require_exact_keys(raw, {"op", "path", "diff"})
    return UnifiedDiff(
        path=_require_str(raw, "path"),
        diff=_require_str(raw, "diff"),
    )


def _require_exact_keys(raw: dict, allowed: set[str]) -> None:
    keys = set(raw.keys())
    missing = allowed - keys
    extra = keys - allowed
    if missing:
        raise ValidationError(
            f"Operation {raw.get('op')!r} missing required keys: {sorted(missing)}"
        )
    if extra:
        raise ValidationError(
            f"Operation {raw.get('op')!r} has unexpected keys: {sorted(extra)}"
        )


def _require_str(raw: dict, key: str) -> str:
    value = raw[key]
    if not isinstance(value, str):
        raise ValidationError(
            f"Field {key!r} must be a string, got {type(value).__name__}"
        )
    return value
