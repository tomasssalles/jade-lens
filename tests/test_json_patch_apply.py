"""Tests for JsonPatch.apply (RFC 6902 patch application)."""

import json
from pathlib import Path

import pytest

from jadelens.operations import ApplyError, JsonPatch
from tests.conftest import commit


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text())


# ---------------------- Happy paths (one op each) ----------------------


def test_add(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"items": []}))
    commit(data_repo)
    JsonPatch(
        path="x.json",
        patch=[{"op": "add", "path": "/items/-", "value": "groceries"}],
    ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"items": ["groceries"]}


def test_replace(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"name": "old"}))
    commit(data_repo)
    JsonPatch(
        path="x.json",
        patch=[{"op": "replace", "path": "/name", "value": "new"}],
    ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"name": "new"}


def test_remove(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"a": 1, "b": 2}))
    commit(data_repo)
    JsonPatch(
        path="x.json", patch=[{"op": "remove", "path": "/a"}]
    ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"b": 2}


def test_move(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"a": 1, "b": 2}))
    commit(data_repo)
    JsonPatch(
        path="x.json",
        patch=[{"op": "move", "from": "/a", "path": "/c"}],
    ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"b": 2, "c": 1}


def test_copy(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"a": 1}))
    commit(data_repo)
    JsonPatch(
        path="x.json",
        patch=[{"op": "copy", "from": "/a", "path": "/b"}],
    ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"a": 1, "b": 1}


def test_test_op_passes_then_other_op_applies(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"a": 1}))
    commit(data_repo)
    JsonPatch(
        path="x.json",
        patch=[
            {"op": "test", "path": "/a", "value": 1},
            {"op": "add", "path": "/b", "value": 2},
        ],
    ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"a": 1, "b": 2}


# ---------------------- Sequential semantics within one patch ----------------------


def test_multiple_ops_apply_sequentially(data_repo: Path):
    """RFC 6902: ops within a patch see the result of previous ops."""
    (data_repo / "x.json").write_text(json.dumps({"items": []}))
    commit(data_repo)
    JsonPatch(
        path="x.json",
        patch=[
            {"op": "add", "path": "/items/-", "value": "a"},
            {"op": "add", "path": "/items/-", "value": "b"},
            {"op": "add", "path": "/items/-", "value": "c"},
        ],
    ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"items": ["a", "b", "c"]}


# ---------------------- Failure modes ----------------------


def test_test_op_fails_raises(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"a": 1}))
    commit(data_repo)
    with pytest.raises(ApplyError, match="failed to apply"):
        JsonPatch(
            path="x.json",
            patch=[{"op": "test", "path": "/a", "value": 999}],
        ).apply(data_repo)


def test_remove_nonexistent_path_raises(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"a": 1}))
    commit(data_repo)
    with pytest.raises(ApplyError, match="failed to apply"):
        JsonPatch(
            path="x.json",
            patch=[{"op": "remove", "path": "/ghost"}],
        ).apply(data_repo)


def test_rejects_missing_target_file(data_repo: Path):
    with pytest.raises(ApplyError, match="does not exist"):
        JsonPatch(
            path="ghost.json",
            patch=[{"op": "add", "path": "/x", "value": 1}],
        ).apply(data_repo)


def test_rejects_directory_target(data_repo: Path):
    (data_repo / "subdir").mkdir()
    # No commit — git doesn't track empty directories so there's nothing to add.
    with pytest.raises(ApplyError, match="not a file"):
        JsonPatch(
            path="subdir",
            patch=[{"op": "add", "path": "/x", "value": 1}],
        ).apply(data_repo)


def test_rejects_non_json_target(data_repo: Path):
    (data_repo / "notes.md").write_text("# not JSON\n\nplain text")
    commit(data_repo)
    with pytest.raises(ApplyError, match="not valid JSON"):
        JsonPatch(
            path="notes.md",
            patch=[{"op": "add", "path": "/x", "value": 1}],
        ).apply(data_repo)


def test_atomicity_test_failure_doesnt_partial_apply(data_repo: Path):
    """A test op failing in the middle of a patch must NOT leave partial changes
    on disk — jsonpatch applies in-memory and we write only on full success."""
    (data_repo / "x.json").write_text(json.dumps({"items": []}))
    commit(data_repo)
    with pytest.raises(ApplyError):
        JsonPatch(
            path="x.json",
            patch=[
                {"op": "add", "path": "/items/-", "value": "a"},
                {"op": "test", "path": "/items/0", "value": "wrong"},
                {"op": "add", "path": "/items/-", "value": "b"},
            ],
        ).apply(data_repo)
    assert _read_json(data_repo / "x.json") == {"items": []}


# ---------------------- Output formatting ----------------------


def test_output_is_pretty_printed_with_trailing_newline(data_repo: Path):
    (data_repo / "x.json").write_text(json.dumps({"a": 1}, separators=(",", ":")))
    commit(data_repo)
    JsonPatch(
        path="x.json",
        patch=[{"op": "add", "path": "/b", "value": 2}],
    ).apply(data_repo)
    written = (data_repo / "x.json").read_text()
    assert "\n" in written
    assert written.endswith("\n")
    # Indented with 2 spaces.
    assert '  "' in written