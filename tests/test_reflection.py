"""Tests for jadelens.reflection.format_reflection."""

from jadelens.reflection import format_reflection


SHA = "abc123def4567890abc123def4567890abc12345"


def test_header_uses_short_sha_and_commit_message():
    out = format_reflection(SHA, "Add groceries", [])
    assert out.startswith("Commit abc123d: Add groceries\n")


def test_single_create_file_block():
    out = format_reflection(
        SHA,
        "Seed todos",
        [{"op": "create_file", "path": "todos.json", "content": "[]\n"}],
    )
    assert "[1/1] create_file at todos.json (3 bytes)" in out
    assert "  []" in out


def test_create_file_byte_count_is_utf8():
    """A multibyte char counts by its UTF-8 length, not codepoint count."""
    out = format_reflection(
        SHA,
        "Add note",
        [{"op": "create_file", "path": "note.md", "content": "é\n"}],
    )
    # 'é' is 2 bytes in UTF-8 + newline = 3.
    assert "(3 bytes)" in out


def test_delete_path_one_liner():
    out = format_reflection(
        SHA, "Drop stale", [{"op": "delete_path", "path": "old/stale.json"}]
    )
    assert "[1/1] delete_path: old/stale.json" in out


def test_rename_path_arrow_notation():
    out = format_reflection(
        SHA,
        "Rename",
        [{"op": "rename_path", "from": "old.md", "to": "new.md"}],
    )
    assert "[1/1] rename_path: old.md → new.md" in out


def test_json_patch_pretty_printed():
    out = format_reflection(
        SHA,
        "Add item",
        [
            {
                "op": "json_patch",
                "path": "data.json",
                "patch": [{"op": "add", "path": "/items/-", "value": "a"}],
            }
        ],
    )
    assert "[1/1] json_patch on data.json" in out
    # Pretty-printed — newlines, indent.
    assert '  [\n' in out
    assert '    {\n' in out
    assert '"value": "a"' in out


def test_unified_diff_body_preserves_raw_diff():
    diff = "@@ -2 +2 @@\n-old\n+new\n"
    out = format_reflection(
        SHA,
        "Edit notes",
        [{"op": "unified_diff", "path": "notes.md", "diff": diff}],
    )
    assert "[1/1] unified_diff on notes.md" in out
    # Each diff line indented.
    assert "  @@ -2 +2 @@" in out
    assert "  -old" in out
    assert "  +new" in out


def test_indexes_count_total_correctly():
    raw = [
        {"op": "delete_path", "path": "a.json"},
        {"op": "delete_path", "path": "b.json"},
        {"op": "delete_path", "path": "c.json"},
    ]
    out = format_reflection(SHA, "Cleanup", raw)
    assert "[1/3] delete_path: a.json" in out
    assert "[2/3] delete_path: b.json" in out
    assert "[3/3] delete_path: c.json" in out


def test_mixed_batch_renders_each_section():
    raw = [
        {"op": "create_file", "path": "new.md", "content": "# hi\n"},
        {"op": "delete_path", "path": "old.json"},
        {"op": "rename_path", "from": "x", "to": "y"},
        {
            "op": "json_patch",
            "path": "data.json",
            "patch": [{"op": "remove", "path": "/k"}],
        },
        {"op": "unified_diff", "path": "z.md", "diff": "@@ -1 +1 @@\n-a\n+A\n"},
    ]
    out = format_reflection(SHA, "Big batch", raw)
    # Headers for each op present.
    for header in [
        "[1/5] create_file at new.md",
        "[2/5] delete_path: old.json",
        "[3/5] rename_path: x → y",
        "[4/5] json_patch on data.json",
        "[5/5] unified_diff on z.md",
    ]:
        assert header in out