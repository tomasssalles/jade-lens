"""Tests for jadelens.operations.parse_operation."""

import pytest

from jadelens.operations import (
    CreateFile,
    DeletePath,
    JsonPatch,
    RenamePath,
    UnifiedDiff,
    ValidationError,
    parse_operation,
)


# ---------------------- Happy paths ----------------------


def test_parse_create_file():
    raw = {"op": "create_file", "path": "todos.json", "content": "{}\n"}
    assert parse_operation(raw) == CreateFile(path="todos.json", content="{}\n")


def test_parse_delete_path():
    raw = {"op": "delete_path", "path": "stale.json"}
    assert parse_operation(raw) == DeletePath(path="stale.json")


def test_parse_rename_path():
    raw = {"op": "rename_path", "from": "old/", "to": "new/"}
    assert parse_operation(raw) == RenamePath(from_path="old/", to_path="new/")


def test_parse_json_patch():
    raw = {
        "op": "json_patch",
        "path": "todos.json",
        "patch": [{"op": "add", "path": "/todos/-", "value": 1}],
    }
    op = parse_operation(raw)
    assert isinstance(op, JsonPatch)
    assert op.path == "todos.json"
    assert op.patch == [{"op": "add", "path": "/todos/-", "value": 1}]


def test_parse_unified_diff():
    raw = {"op": "unified_diff", "path": "notes.md", "diff": "--- a/...\n"}
    assert parse_operation(raw) == UnifiedDiff(
        path="notes.md", diff="--- a/...\n"
    )


# ---------------------- Failure modes ----------------------


def test_non_dict_raises():
    with pytest.raises(ValidationError, match="must be a JSON object"):
        parse_operation("not a dict")


def test_missing_op_field_raises():
    with pytest.raises(ValidationError, match="missing 'op' field"):
        parse_operation({"path": "x"})


def test_unknown_op_type_raises():
    with pytest.raises(ValidationError, match="Unknown op type"):
        parse_operation({"op": "frobnicate", "path": "x"})


def test_missing_required_field_raises():
    with pytest.raises(ValidationError, match="missing required keys"):
        parse_operation({"op": "create_file", "path": "x"})  # no content


def test_extra_field_raises():
    with pytest.raises(ValidationError, match="unexpected keys"):
        parse_operation(
            {"op": "delete_path", "path": "x", "bonus": True}
        )


def test_wrong_field_type_raises():
    with pytest.raises(ValidationError, match="must be a string"):
        parse_operation({"op": "create_file", "path": 42, "content": "x"})


def test_json_patch_with_non_list_patch_raises():
    raw = {"op": "json_patch", "path": "x.json", "patch": "not a list"}
    with pytest.raises(ValidationError, match="'patch' must be a list"):
        parse_operation(raw)


def test_json_patch_with_bare_patch_dict_instead_of_list_raises():
    """Realistic bot mistake: forgetting to wrap a single patch op in a list."""
    raw = {
        "op": "json_patch",
        "path": "todos.json",
        # Looks like a perfectly valid RFC 6902 op — but the bot forgot the [ ].
        "patch": {"op": "add", "path": "/todos/-", "value": "groceries"},
    }
    with pytest.raises(ValidationError, match="'patch' must be a list"):
        parse_operation(raw)


def test_rename_path_missing_to_raises():
    raw = {"op": "rename_path", "from": "a"}
    with pytest.raises(ValidationError, match="missing required keys"):
        parse_operation(raw)
