"""Tests for jadelens.stash — the /jade stash-entry construction, kept
byte-identical to the web app's web/src/sync/stash.js."""

from jadelens.stash import (
    batch_touched_paths,
    build_stash_entry,
    compact_timestamp,
    describe_operation,
    serialize_stash_entry,
    stash_filename,
)

TS = "2026-06-01T14:30:22.123456+00:00"


def test_batch_touched_paths_in_file_ops():
    assert batch_touched_paths([{"op": "json_patch", "path": "a.md"}], ["a.md"]) == {"a.md"}


def test_batch_touched_paths_directory_delete_expands():
    universe = ["dir/x.md", "dir/y.md", "other.md"]
    assert batch_touched_paths([{"op": "delete_path", "path": "dir"}], universe) == {
        "dir/x.md",
        "dir/y.md",
    }


def test_batch_touched_paths_rename_covers_source_and_destination():
    universe = ["dir/x.md", "dir/y.md"]
    assert batch_touched_paths(
        [{"op": "rename_path", "from": "dir", "to": "moved"}], universe
    ) == {"dir/x.md", "dir/y.md", "moved", "moved/x.md", "moved/y.md"}


def test_build_stash_entry_captures_pristine_ancestors_sorted():
    base = {"z.md": "Z\n", "a.md": "A\n", "untouched.md": "u\n"}
    ops = [
        {"op": "unified_diff", "path": "z.md", "diff": "..."},
        {"op": "unified_diff", "path": "a.md", "diff": "..."},
    ]
    entry = build_stash_entry(ops, TS, base)
    assert entry["timestamp"] == TS
    assert list(entry["ancestors"].keys()) == ["a.md", "z.md"]  # sorted
    assert entry["ancestors"] == {"a.md": "A\n", "z.md": "Z\n"}
    assert entry["operations"] is ops


def test_build_stash_entry_omits_created_files():
    entry = build_stash_entry(
        [{"op": "create_file", "path": "new.md", "content": "x\n"}],
        TS,
        {"existing.md": "e\n"},
    )
    assert entry["ancestors"] == {}


def test_serialize_is_two_space_json_with_trailing_newline():
    entry = {
        "timestamp": "2026-06-01T14:30:22Z",
        "ancestors": {"a.md": "x\n"},
        "operations": [{"op": "unified_diff", "path": "a.md", "diff": "d"}],
    }
    expected = (
        "{\n"
        '  "timestamp": "2026-06-01T14:30:22Z",\n'
        '  "ancestors": {\n'
        '    "a.md": "x\\n"\n'
        "  },\n"
        '  "operations": [\n'
        "    {\n"
        '      "op": "unified_diff",\n'
        '      "path": "a.md",\n'
        '      "diff": "d"\n'
        "    }\n"
        "  ]\n"
        "}\n"
    )
    assert serialize_stash_entry(entry) == expected


def test_compact_timestamp_handles_microseconds_and_offset():
    assert compact_timestamp("2026-06-01T14:30:22.123456+00:00") == "20260601T143022Z"
    assert compact_timestamp("2026-06-01T14:30:22.123Z") == "20260601T143022Z"


def test_stash_filename_format():
    assert (
        stash_filename(TS, "a1b2c3d4") == ".jade/stash/20260601T143022Z-a1b2c3d4.json"
    )


def test_describe_operation_variants():
    assert describe_operation({"op": "create_file", "path": "a.md"}) == "Created a.md"
    assert describe_operation({"op": "delete_path", "path": "a.md"}) == "Deleted a.md"
    assert (
        describe_operation({"op": "rename_path", "from": "a.md", "to": "b.md"})
        == "Renamed a.md → b.md"
    )
    assert (
        describe_operation({"op": "json_patch", "path": "x.json", "patch": [{}, {}]})
        == "Modified x.json (2 JSON changes)"
    )
    diff = "--- a/x.md\n+++ b/x.md\n@@ -1,1 +1,1 @@\n-old\n+new\n"
    assert (
        describe_operation({"op": "unified_diff", "path": "x.md", "diff": diff})
        == "Modified 2 lines in x.md"
    )
