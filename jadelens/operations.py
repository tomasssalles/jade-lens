"""Typed operation classes for handle_bot_response.

Each ``Operation`` knows its inputs after structural validation, and how
to ``apply`` itself to a data repo. ``apply`` mutates the data repo's
working tree (and, for delete/rename, the git index too) but does not
commit; the workflow orchestrator (jadelens.handle_bot_response) commits
after all ops in a batch have applied successfully.
"""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jsonpatch

from jadelens.unified_diff import (
    DiffApplyError,
    DiffParseError,
    apply_unified_diff,
)


class ValidationError(Exception):
    """A bot-emitted operation failed structural validation."""


class ApplyError(Exception):
    """An operation failed during application to the data repo."""


# The set of file suffixes the bot is allowed to *create*. Adding a new
# entry here automatically extends what unified_diff can target (since
# unified_diff allows anything except .json — the json_patch path).
EDITABLE_FILE_SUFFIXES = (".json", ".md")


@dataclass(slots=True, frozen=True)
class CreateFile:
    path: str
    content: str

    def apply(self, data_repo: Path) -> None:
        target = data_repo / self.path
        if target.exists():
            raise ApplyError(f"create_file: target already exists: {self.path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(self.content)


@dataclass(slots=True, frozen=True)
class DeletePath:
    """Recursive delete of a file or directory (``git rm -r``)."""

    path: str

    def apply(self, data_repo: Path) -> None:
        target = data_repo / self.path
        if not target.exists():
            raise ApplyError(f"delete_path: target does not exist: {self.path}")
        # `git rm -r --force` handles file or directory and stages deletion.
        _git(data_repo, ["rm", "-r", "--force", "--", self.path])


@dataclass(slots=True, frozen=True)
class RenamePath:
    from_path: str
    to_path: str

    def apply(self, data_repo: Path) -> None:
        source = data_repo / self.from_path
        target = data_repo / self.to_path
        if not source.exists():
            raise ApplyError(
                f"rename_path: source does not exist: {self.from_path}"
            )
        if target.exists():
            raise ApplyError(
                f"rename_path: target already exists: {self.to_path}"
            )
        # If renaming a file (not a directory), the target must share the
        # source's suffix — we don't allow type-changing renames like
        # notes.md → notes.json, which would mis-classify the file's content
        # under our op-vs-suffix rules (json_patch only on .json, etc.).
        if source.is_file() and source.suffix != target.suffix:
            raise ApplyError(
                f"rename_path: file suffix must be preserved "
                f"(source {source.suffix!r}, target {target.suffix!r})"
            )
        # git mv doesn't auto-create the target's parent directory; do it
        # ourselves so renames into a new subdirectory work in one step
        # (symmetric with create_file's mkdir -p of missing parents).
        target.parent.mkdir(parents=True, exist_ok=True)
        _git(data_repo, ["mv", "--", self.from_path, self.to_path])


@dataclass(slots=True, frozen=True)
class JsonPatch:
    path: str
    patch: list[dict[str, Any]]

    def apply(self, data_repo: Path) -> None:
        target = data_repo / self.path
        if not target.exists():
            raise ApplyError(
                f"json_patch: target file does not exist: {self.path}"
            )
        if not target.is_file():
            raise ApplyError(
                f"json_patch: target is not a file: {self.path}"
            )

        try:
            original = json.loads(target.read_text())
        except json.JSONDecodeError as e:
            raise ApplyError(
                f"json_patch: target {self.path} is not valid JSON: {e}"
            ) from e

        try:
            patch = jsonpatch.JsonPatch(self.patch)
            result = patch.apply(original)
        except jsonpatch.JsonPatchException as e:
            raise ApplyError(
                f"json_patch: failed to apply patch on {self.path}: {e}"
            ) from e

        target.write_text(json.dumps(result, indent=2) + "\n")


@dataclass(slots=True, frozen=True)
class UnifiedDiff:
    path: str
    diff: str

    def apply(self, data_repo: Path) -> None:
        target = data_repo / self.path
        if not target.exists():
            raise ApplyError(
                f"unified_diff: target file does not exist: {self.path}"
            )
        if not target.is_file():
            raise ApplyError(
                f"unified_diff: target is not a file: {self.path}"
            )

        original = target.read_text()
        try:
            new_content = apply_unified_diff(original, self.diff)
        except DiffParseError as e:
            raise ApplyError(
                f"unified_diff: parse error on {self.path}: {e}"
            ) from e
        except DiffApplyError as e:
            raise ApplyError(
                f"unified_diff: apply failed on {self.path}: {e}"
            ) from e

        target.write_text(new_content)


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
    path = _require_str(raw, "path")
    if not path.endswith(EDITABLE_FILE_SUFFIXES):
        raise ValidationError(
            f"create_file path must end with one of {EDITABLE_FILE_SUFFIXES} "
            f"(got {path!r})"
        )
    return CreateFile(path=path, content=_require_str(raw, "content"))


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
    path = _require_str(raw, "path")
    if not path.endswith(".json"):
        raise ValidationError(
            f"json_patch path must end with '.json' (got {path!r}); "
            f"use unified_diff for non-JSON files"
        )
    patch = raw["patch"]
    if not isinstance(patch, list):
        raise ValidationError(
            f"json_patch 'patch' must be a list, got {type(patch).__name__}"
        )
    return JsonPatch(path=path, patch=patch)


def _parse_unified_diff(raw: dict) -> UnifiedDiff:
    _require_exact_keys(raw, {"op", "path", "diff"})
    path = _require_str(raw, "path")
    if path.endswith(".json"):
        raise ValidationError(
            f"unified_diff cannot target JSON files (got {path!r}); "
            f"use json_patch for .json files"
        )
    return UnifiedDiff(path=path, diff=_require_str(raw, "diff"))


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


def _git(data_repo: Path, args: list[str]) -> None:
    """Run a git command in ``data_repo``, raising ``ApplyError`` on failure."""
    result = subprocess.run(
        ["git", "-C", str(data_repo), *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise ApplyError(
            f"`git {' '.join(args)}` failed: {result.stderr.strip()}"
        )
