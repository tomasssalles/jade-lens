"""Typed operation classes for jadelens-apply.

Each ``Operation`` knows its inputs after structural validation, and how
to ``apply`` itself to a data repo. ``apply`` mutates the data repo's
working tree (and, for delete/rename, the git index too) but does not
commit; the workflow orchestrator (jadelens.apply) commits after all
ops in a batch have applied successfully.
"""

import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import jsonpatch

from jadelens.unified_diff import (
    DiffApplyError,
    DiffParseError,
    apply_unified_diff,
)


class ConformanceError(Exception):
    """Base for pipeline errors that carry a stable, language-agnostic code.

    The ``code`` is the cross-client contract (see conformance/README.md §5):
    prose messages may be reworded freely, but the code is what the
    conformance suite asserts on. ``code`` may be ``None`` for legacy raise
    sites not yet assigned a code.
    """

    code: str | None = None

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code


class ValidationError(ConformanceError):
    """A bot-emitted operation failed structural validation."""


class ApplyError(ConformanceError):
    """An operation failed during application to the data repo."""


# The set of file suffixes the bot is allowed to *create*. Adding a new
# entry here automatically extends what unified_diff can target (since
# unified_diff allows anything except .json — the json_patch path).
EDITABLE_FILE_SUFFIXES = (".json", ".md")


# JS switches Number→string to exponent notation at this magnitude; below it,
# integer-valued numbers print as plain digits (which a Python ``int`` matches).
_JS_INTEGER_PRINT_LIMIT = 1e21


def _to_js_canonical(obj: Any) -> Any:
    """Normalise a parsed-JSON value to the form a JS client would produce.

    JS is representationally weaker than Python for JSON numbers: after
    ``JSON.parse`` an integer-valued float like ``1.0`` is already the Number
    ``1`` and re-serialises as ``1``. For the cross-client byte-identity
    contract (conformance/README.md §3–§4) the canonical serialisation is the
    JS form, so Python converts integer-valued floats to ints before dumping.
    Genuine fractions (``1.5``) are written identically by both clients and
    pass through unchanged.

    Only magnitudes JS prints as plain integer digits are converted; at
    ``abs(x) >= 1e21`` JS uses exponent notation (``"1e+21"``), which a plain
    ``int`` would not reproduce, so those stay floats (a known residual edge —
    such magnitudes don't occur in this domain; see conformance/PENDING_WORK.md
    §A.4).
    """
    if isinstance(obj, bool):
        # bool is a subclass of int — never coerce it.
        return obj
    if isinstance(obj, float):
        if math.isfinite(obj) and obj.is_integer() and abs(obj) < _JS_INTEGER_PRINT_LIMIT:
            return int(obj)
        return obj
    if isinstance(obj, dict):
        return {k: _to_js_canonical(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_js_canonical(v) for v in obj]
    return obj


def dumps_js_canonical(obj: Any) -> str:
    """Serialise ``obj`` to the canonical JS-faithful form, byte-matching
    ``JSON.stringify(obj, null, 2) + "\\n"``.

    Two deltas from a bare ``json.dumps(obj, indent=2)``: ``ensure_ascii=False``
    (JS emits raw UTF-8, not ``\\uXXXX``) and the integer-valued-float
    normalisation in ``_to_js_canonical``. Item/key separators already match JS
    at ``indent=2``. This is the single byte-contract serialisation site for
    re-serialised ``.json`` data files (conformance/README.md §3–§4).
    """
    return json.dumps(_to_js_canonical(obj), ensure_ascii=False, indent=2) + "\n"


@dataclass(slots=True, frozen=True)
class CreateFile:
    path: str
    content: str

    def apply(self, data_repo: Path) -> None:
        target = data_repo / self.path
        if target.exists():
            raise ApplyError(
                f"create_file: target already exists: {self.path}",
                code="TARGET_EXISTS",
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(self.content)


@dataclass(slots=True, frozen=True)
class DeletePath:
    """Recursive delete of a file or directory (``git rm -r``)."""

    path: str

    def apply(self, data_repo: Path) -> None:
        target = data_repo / self.path
        if not target.exists():
            raise ApplyError(
                f"delete_path: target does not exist: {self.path}",
                code="TARGET_NOT_FOUND",
            )
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
                f"rename_path: source does not exist: {self.from_path}",
                code="TARGET_NOT_FOUND",
            )
        if target.exists():
            raise ApplyError(
                f"rename_path: target already exists: {self.to_path}",
                code="TARGET_EXISTS",
            )
        # If renaming a file (not a directory), the target must share the
        # source's suffix — we don't allow type-changing renames like
        # notes.md → notes.json, which would mis-classify the file's content
        # under our op-vs-suffix rules (json_patch only on .json, etc.).
        if source.is_file() and source.suffix != target.suffix:
            raise ApplyError(
                f"rename_path: file suffix must be preserved "
                f"(source {source.suffix!r}, target {target.suffix!r})",
                code="RENAME_SUFFIX_CHANGED",
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
                f"json_patch: target file does not exist: {self.path}",
                code="TARGET_NOT_FOUND",
            )
        if not target.is_file():
            raise ApplyError(
                f"json_patch: target is not a file: {self.path}",
                code="TARGET_NOT_A_FILE",
            )

        try:
            original = json.loads(target.read_text())
        except json.JSONDecodeError as e:
            raise ApplyError(
                f"json_patch: target {self.path} is not valid JSON: {e}",
                code="JSON_PATCH_TARGET_INVALID_JSON",
            ) from e

        try:
            patch = jsonpatch.JsonPatch(self.patch)
            result = patch.apply(original)
        except jsonpatch.JsonPatchException as e:
            raise ApplyError(
                f"json_patch: failed to apply patch on {self.path}: {e}",
                code="JSON_PATCH_APPLY_FAILED",
            ) from e

        target.write_text(dumps_js_canonical(result))


@dataclass(slots=True, frozen=True)
class UnifiedDiff:
    path: str
    diff: str

    def apply(self, data_repo: Path) -> None:
        target = data_repo / self.path
        if not target.exists():
            raise ApplyError(
                f"unified_diff: target file does not exist: {self.path}",
                code="TARGET_NOT_FOUND",
            )
        if not target.is_file():
            raise ApplyError(
                f"unified_diff: target is not a file: {self.path}",
                code="TARGET_NOT_A_FILE",
            )

        original = target.read_text()
        try:
            new_content = apply_unified_diff(original, self.diff)
        except DiffParseError as e:
            raise ApplyError(
                f"unified_diff: parse error on {self.path}: {e}",
                code="UNIFIED_DIFF_PARSE_FAILED",
            ) from e
        except DiffApplyError as e:
            raise ApplyError(
                f"unified_diff: apply failed on {self.path}: {e}",
                code="UNIFIED_DIFF_APPLY_FAILED",
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
            f"Operation must be a JSON object, got {type(raw).__name__}",
            code="OP_NOT_OBJECT",
        )
    op_type = raw.get("op")
    if op_type is None:
        raise ValidationError("Operation missing 'op' field", code="OP_MISSING_OP_FIELD")

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
            f"Unknown op type {op_type!r}. Allowed: {sorted(parsers)}",
            code="OP_UNKNOWN_TYPE",
        )
    return parser(raw)


def _parse_create_file(raw: dict) -> CreateFile:
    _require_exact_keys(raw, {"op", "path", "content"})
    path = _require_str(raw, "path")
    _reject_protected_path(path)
    if not path.endswith(EDITABLE_FILE_SUFFIXES):
        raise ValidationError(
            f"create_file path must end with one of {EDITABLE_FILE_SUFFIXES} "
            f"(got {path!r})",
            code="CREATE_FILE_BAD_SUFFIX",
        )
    content = _require_str(raw, "content")
    if path.endswith(".json"):
        try:
            json.loads(content)
        except json.JSONDecodeError as e:
            raise ValidationError(
                f"create_file content for {path!r} is not valid JSON: {e}",
                code="CREATE_FILE_INVALID_JSON",
            ) from e
    return CreateFile(path=path, content=content)


def _parse_delete_path(raw: dict) -> DeletePath:
    _require_exact_keys(raw, {"op", "path"})
    path = _require_str(raw, "path")
    _reject_protected_path(path)
    return DeletePath(path=path)


def _parse_rename_path(raw: dict) -> RenamePath:
    _require_exact_keys(raw, {"op", "from", "to"})
    from_path = _require_str(raw, "from")
    to_path = _require_str(raw, "to")
    _reject_protected_path(from_path, field="from")
    _reject_protected_path(to_path, field="to")
    return RenamePath(from_path=from_path, to_path=to_path)


def _parse_json_patch(raw: dict) -> JsonPatch:
    _require_exact_keys(raw, {"op", "path", "patch"})
    path = _require_str(raw, "path")
    _reject_protected_path(path)
    if not path.endswith(".json"):
        raise ValidationError(
            f"json_patch path must end with '.json' (got {path!r}); "
            f"use unified_diff for non-JSON files",
            code="JSON_PATCH_WRONG_SUFFIX",
        )
    patch = raw["patch"]
    if not isinstance(patch, list):
        raise ValidationError(
            f"json_patch 'patch' must be a list, got {type(patch).__name__}",
            code="OP_WRONG_FIELD_TYPE",
        )
    return JsonPatch(path=path, patch=patch)


def _parse_unified_diff(raw: dict) -> UnifiedDiff:
    _require_exact_keys(raw, {"op", "path", "diff"})
    path = _require_str(raw, "path")
    _reject_protected_path(path)
    if path.endswith(".json"):
        raise ValidationError(
            f"unified_diff cannot target JSON files (got {path!r}); "
            f"use json_patch for .json files",
            code="UNIFIED_DIFF_WRONG_SUFFIX",
        )
    return UnifiedDiff(path=path, diff=_require_str(raw, "diff"))


def _reject_protected_path(path: str, field: str = "path") -> None:
    """Reject any path whose top-level component starts with '.'.

    Top-level dot-prefixed paths (``.claude/``, ``.git/``, ``.gitignore``,
    ``.jade/``, ``.python-version``, ...) are reserved for tooling and
    out of bounds for the bot. Nested paths like
    ``projects/.draft/notes.md`` are fine — only the leading component
    matters. PurePosixPath normalises ``./notes.md`` to ``notes.md``, so
    that's not falsely rejected.
    """
    parts = PurePosixPath(path).parts
    if parts and parts[0].startswith("."):
        raise ValidationError(
            f"{field} {path!r} targets a protected top-level path. "
            f"Anything starting with '.' (.claude/, .git/, .gitignore, "
            f".jade/, ...) is reserved for tooling and out of bounds.",
            code="PROTECTED_PATH",
        )


def _require_exact_keys(raw: dict, allowed: set[str]) -> None:
    keys = set(raw.keys())
    missing = allowed - keys
    extra = keys - allowed
    if missing:
        raise ValidationError(
            f"Operation {raw.get('op')!r} missing required keys: {sorted(missing)}",
            code="OP_MISSING_KEYS",
        )
    if extra:
        raise ValidationError(
            f"Operation {raw.get('op')!r} has unexpected keys: {sorted(extra)}",
            code="OP_UNEXPECTED_KEYS",
        )


def _require_str(raw: dict, key: str) -> str:
    value = raw[key]
    if not isinstance(value, str):
        raise ValidationError(
            f"Field {key!r} must be a string, got {type(value).__name__}",
            code="OP_WRONG_FIELD_TYPE",
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
