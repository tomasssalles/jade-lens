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


class ValidationError(Exception):
    """A bot-emitted operation failed structural validation."""


class ApplyError(Exception):
    """An operation failed during application to the data repo."""


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
