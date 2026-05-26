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


def test_json_patch_rejects_non_json_path():
    """A bot using json_patch on a non-JSON file is a likely mistake."""
    raw = {
        "op": "json_patch",
        "path": "notes.md",
        "patch": [{"op": "add", "path": "/x", "value": 1}],
    }
    with pytest.raises(ValidationError, match="must end with '.json'"):
        parse_operation(raw)


def test_unified_diff_rejects_json_path():
    """A bot using unified_diff on a .json file is a likely mistake;
    json_patch is the right tool for JSON."""
    raw = {"op": "unified_diff", "path": "data.json", "diff": "@@ -1 +1 @@\n-a\n+A\n"}
    with pytest.raises(ValidationError, match="cannot target JSON"):
        parse_operation(raw)


def test_unified_diff_accepts_non_json_extension():
    """unified_diff allows any non-.json suffix — extensible to future
    text-like file types without changing this rule."""
    raw = {"op": "unified_diff", "path": "notes.md", "diff": "@@ -1 +1 @@\n-a\n+A\n"}
    parse_operation(raw)  # must not raise


def test_create_file_rejects_unsupported_suffix():
    """create_file is restricted to the editable file-type set; the bot
    shouldn't be able to create e.g. 'notes.txt' because then it couldn't
    coherently edit it later (we'd have to delete-and-recreate)."""
    raw = {"op": "create_file", "path": "notes.txt", "content": "hi"}
    with pytest.raises(ValidationError, match="must end with one of"):
        parse_operation(raw)


def test_create_file_accepts_md():
    raw = {"op": "create_file", "path": "notes.md", "content": "# notes\n"}
    parse_operation(raw)  # must not raise


def test_create_file_with_json_path_validates_content_is_json():
    """If the bot creates a .json file with single-quoted keys (or any other
    invalid JSON), parse rejects it before any apply happens — otherwise the
    file gets created and only fails later on the first json_patch."""
    raw = {
        "op": "create_file",
        "path": "data.json",
        "content": "{'key': 'value'}",  # single quotes — not valid JSON
    }
    with pytest.raises(ValidationError, match="not valid JSON"):
        parse_operation(raw)


def test_create_file_with_md_path_allows_arbitrary_content():
    """No content validation for markdown — anything's allowed."""
    raw = {
        "op": "create_file",
        "path": "notes.md",
        "content": "{ this is not JSON, but it's fine in markdown }",
    }
    parse_operation(raw)  # must not raise


# ---------------------- Protected-path rejection ----------------------
# Top-level dot-prefixed paths (.claude/, .git/, .gitignore, .jade/, …)
# are reserved for tooling. The bot must not touch them via any op.


@pytest.mark.parametrize(
    "path",
    [
        ".claude/skills/x/SKILL.md",
        ".gitignore",
        ".jade/version",
        ".python-version",
        "./.jade/index.json",  # normalised by PurePosixPath to .jade/index.json
    ],
)
def test_create_file_rejects_protected_path(path):
    raw = {"op": "create_file", "path": path, "content": "{}"}
    with pytest.raises(ValidationError, match="protected top-level path"):
        parse_operation(raw)


def test_delete_path_rejects_protected_path():
    raw = {"op": "delete_path", "path": ".jade/operations-log"}
    with pytest.raises(ValidationError, match="protected top-level path"):
        parse_operation(raw)


def test_rename_path_rejects_protected_from():
    raw = {"op": "rename_path", "from": ".jade/version", "to": "version.txt"}
    with pytest.raises(ValidationError, match="from .* protected top-level path"):
        parse_operation(raw)


def test_rename_path_rejects_protected_to():
    raw = {"op": "rename_path", "from": "old.md", "to": ".claude/oops.md"}
    with pytest.raises(ValidationError, match="to .* protected top-level path"):
        parse_operation(raw)


def test_json_patch_rejects_protected_path():
    raw = {
        "op": "json_patch",
        "path": ".jade/index.json",
        "patch": [{"op": "add", "path": "/x", "value": 1}],
    }
    with pytest.raises(ValidationError, match="protected top-level path"):
        parse_operation(raw)


def test_unified_diff_rejects_protected_path():
    raw = {"op": "unified_diff", "path": ".gitignore", "diff": "@@ -1 +1 @@\n-a\n+b\n"}
    with pytest.raises(ValidationError, match="protected top-level path"):
        parse_operation(raw)


def test_protected_check_allows_nested_dot_directories():
    """A '.' as a nested component (not the leading one) is fine — only the
    top-level component triggers the rule."""
    raw = {"op": "create_file", "path": "projects/.draft/notes.md", "content": "x"}
    parse_operation(raw)  # must not raise


def test_protected_check_allows_leading_dot_slash():
    """PurePosixPath strips './' from the front, so './notes.md' resolves to
    'notes.md' and is allowed."""
    raw = {"op": "create_file", "path": "./notes.md", "content": "# notes\n"}
    parse_operation(raw)  # must not raise
