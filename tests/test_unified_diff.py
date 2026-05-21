"""Tests for jadelens.unified_diff (parser + applier) and the
UnifiedDiff op's integration with apply_unified_diff."""

from pathlib import Path

import pytest

from jadelens.operations import ApplyError, UnifiedDiff
from jadelens.unified_diff import (
    DiffApplyError,
    DiffParseError,
    Hunk,
    apply_unified_diff,
    parse_unified_diff,
)
from tests.conftest import commit


# ====================================================================
# Parser tests
# ====================================================================


def test_parse_empty_diff_returns_no_hunks():
    assert parse_unified_diff("") == []


def test_parse_only_preamble_returns_no_hunks():
    assert parse_unified_diff("--- a/notes.md\n+++ b/notes.md\n") == []


def test_parse_skips_preamble_lines_before_first_hunk():
    diff = "--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-old\n+new\n"
    hunks = parse_unified_diff(diff)
    assert hunks == [
        Hunk(old_start=1, old_count=1, removed_lines=("old",), added_lines=("new",))
    ]


def test_parse_single_replace_hunk():
    diff = "@@ -2 +2 @@\n-old\n+new\n"
    assert parse_unified_diff(diff) == [
        Hunk(old_start=2, old_count=1, removed_lines=("old",), added_lines=("new",))
    ]


def test_parse_single_pure_insert_hunk():
    diff = "@@ -3,0 +4 @@\n+inserted\n"
    assert parse_unified_diff(diff) == [
        Hunk(old_start=3, old_count=0, removed_lines=(), added_lines=("inserted",))
    ]


def test_parse_single_pure_delete_hunk():
    diff = "@@ -2 +1,0 @@\n-doomed\n"
    assert parse_unified_diff(diff) == [
        Hunk(old_start=2, old_count=1, removed_lines=("doomed",), added_lines=())
    ]


def test_parse_multi_line_replace():
    diff = "@@ -3,2 +3,3 @@\n-old1\n-old2\n+new1\n+new2\n+new3\n"
    assert parse_unified_diff(diff) == [
        Hunk(
            old_start=3,
            old_count=2,
            removed_lines=("old1", "old2"),
            added_lines=("new1", "new2", "new3"),
        )
    ]


def test_parse_multiple_hunks():
    diff = (
        "@@ -2 +2 @@\n-b\n+B\n"
        "@@ -4,0 +5 @@\n+X\n"
    )
    assert parse_unified_diff(diff) == [
        Hunk(old_start=2, old_count=1, removed_lines=("b",), added_lines=("B",)),
        Hunk(old_start=4, old_count=0, removed_lines=(), added_lines=("X",)),
    ]


def test_parse_default_count_when_omitted():
    """Omitted N/M defaults to 1 per unified-diff convention."""
    diff = "@@ -2 +2 @@\n-old\n+new\n"
    [hunk] = parse_unified_diff(diff)
    assert hunk.old_count == 1


def test_parse_diff_without_trailing_newline():
    diff = "@@ -1 +1 @@\n-old\n+new"
    [hunk] = parse_unified_diff(diff)
    assert hunk.removed_lines == ("old",)
    assert hunk.added_lines == ("new",)


def test_parse_header_with_trailing_section_text():
    """`git diff --no-index -U0` emits headers with trailing text after the
    second `@@` — typically the line just before the changed range, as a
    section anchor. The parser must accept and ignore it."""
    diff = "@@ -5 +5 @@ def previous_function():\n-old\n+new\n"
    [hunk] = parse_unified_diff(diff)
    assert hunk == Hunk(
        old_start=5, old_count=1, removed_lines=("old",), added_lines=("new",)
    )


# ---------- Parser failure modes ----------


def test_parse_malformed_header_raises():
    with pytest.raises(DiffParseError, match="Malformed hunk header"):
        parse_unified_diff("@@ bad header @@\n-x\n+y\n")


def test_parse_context_line_rejected():
    diff = "@@ -2,3 +2,3 @@\n a\n-b\n+B\n c\n"
    with pytest.raises(DiffParseError, match="Context lines are not supported"):
        parse_unified_diff(diff)


def test_parse_removed_count_mismatch_raises():
    diff = "@@ -1,2 +1 @@\n-only-one\n+new\n"
    with pytest.raises(DiffParseError, match="declared 2 removed line"):
        parse_unified_diff(diff)


def test_parse_added_count_mismatch_raises():
    diff = "@@ -1 +1,3 @@\n-old\n+only-one\n"
    with pytest.raises(DiffParseError, match="declared 3 added line"):
        parse_unified_diff(diff)


def test_parse_rejects_unknown_line_in_hunk_body():
    diff = "@@ -1 +1 @@\n-old\nweird\n+new\n"
    with pytest.raises(DiffParseError, match="Unexpected line in hunk body"):
        parse_unified_diff(diff)


# ---------- Ordering / overlap ----------


def test_parse_canonicalises_out_of_order_hunks():
    """Bot may emit hunks in any order; parse sorts them before the
    overlap check. Semantically equivalent inputs converge."""
    diff = "@@ -5 +5 @@\n-e\n+E\n@@ -2 +2 @@\n-b\n+B\n"
    hunks = parse_unified_diff(diff)
    assert [h.old_start for h in hunks] == [2, 5]


def test_parse_canonicalises_pure_insert_emitted_before_addressing_at_same_line():
    """At the same old_start, addressing sorts before pure-insert
    (the addressing hits the line itself; the insert lands at the boundary
    just after). Either input order yields the same canonical sequence."""
    diff = "@@ -5,0 +6 @@\n+X\n@@ -5 +5 @@\n-e\n+E\n"
    hunks = parse_unified_diff(diff)
    assert hunks[0].old_count == 1  # addressing first
    assert hunks[1].old_count == 0  # pure insert second


def test_parse_rejects_overlapping_addressing_hunks():
    diff = "@@ -2,3 +2,3 @@\n-b\n-c\n-d\n+B\n+C\n+D\n@@ -3 +3 @@\n-c\n+CC\n"
    with pytest.raises(DiffParseError, match="out of order or overlapping"):
        parse_unified_diff(diff)


def test_parse_rejects_two_pure_inserts_at_same_point():
    diff = "@@ -5,0 +6 @@\n+X\n@@ -5,0 +6 @@\n+Y\n"
    with pytest.raises(DiffParseError, match="out of order or overlapping"):
        parse_unified_diff(diff)


def test_parse_rejects_pure_insert_inside_addressing_range():
    """Insert at 'after line 4' is inside the range of an addressing hunk
    covering lines 4–5 — overlap, must be rejected."""
    diff = "@@ -4,2 +4,2 @@\n-d\n-e\n+D\n+E\n@@ -4,0 +5 @@\n+X\n"
    with pytest.raises(DiffParseError, match="out of order or overlapping"):
        parse_unified_diff(diff)


def test_parse_accepts_addressing_then_pure_insert_at_boundary():
    """Replace line 5, then insert after line 5 — valid, the insert lands
    at the boundary just after A's addressed range."""
    diff = "@@ -5 +5 @@\n-old\n+new\n@@ -5,0 +6 @@\n+X\n"
    hunks = parse_unified_diff(diff)
    assert len(hunks) == 2


def test_parse_accepts_two_pure_inserts_at_different_points():
    diff = "@@ -3,0 +4 @@\n+X\n@@ -5,0 +7 @@\n+Y\n"
    hunks = parse_unified_diff(diff)
    assert len(hunks) == 2


def test_parse_accepts_pure_insert_then_addressing_next_line():
    diff = "@@ -3,0 +4 @@\n+X\n@@ -4 +5 @@\n-d\n+D\n"
    hunks = parse_unified_diff(diff)
    assert len(hunks) == 2


# ====================================================================
# Applier tests
# ====================================================================


# ---------- Happy paths ----------


def test_apply_replace_single_line():
    original = "a\nb\nc\n"
    diff = "@@ -2 +2 @@\n-b\n+B\n"
    assert apply_unified_diff(original, diff) == "a\nB\nc\n"


def test_apply_insert_at_start():
    original = "a\nb\n"
    diff = "@@ -0,0 +1 @@\n+first\n"
    assert apply_unified_diff(original, diff) == "first\na\nb\n"


def test_apply_insert_at_end():
    original = "a\nb\nc\n"
    diff = "@@ -3,0 +4 @@\n+last\n"
    assert apply_unified_diff(original, diff) == "a\nb\nc\nlast\n"


def test_apply_insert_in_middle():
    original = "a\nc\n"
    diff = "@@ -1,0 +2 @@\n+b\n"
    assert apply_unified_diff(original, diff) == "a\nb\nc\n"


def test_apply_pure_delete():
    original = "a\nb\nc\n"
    diff = "@@ -2 +1,0 @@\n-b\n"
    assert apply_unified_diff(original, diff) == "a\nc\n"


def test_apply_multi_line_replace():
    original = "a\nb\nc\nd\ne\n"
    diff = "@@ -2,3 +2,2 @@\n-b\n-c\n-d\n+B\n+C\n"
    assert apply_unified_diff(original, diff) == "a\nB\nC\ne\n"


def test_apply_multiple_hunks():
    original = "a\nb\nc\nd\ne\n"
    diff = (
        "@@ -2 +2 @@\n-b\n+B\n"
        "@@ -4,0 +5 @@\n+X\n"
    )
    assert apply_unified_diff(original, diff) == "a\nB\nc\nd\nX\ne\n"


def test_apply_addressing_then_insert_at_boundary():
    """Replace line 5 and also insert after line 5 — both reference original."""
    original = "a\nb\nc\nd\ne\nf\n"
    diff = "@@ -5 +5 @@\n-e\n+E\n@@ -5,0 +6 @@\n+X\n"
    assert apply_unified_diff(original, diff) == "a\nb\nc\nd\nE\nX\nf\n"


# ---------- File-state preservation ----------


def test_apply_preserves_file_without_trailing_newline():
    original = "a\nb\nc"  # no trailing newline
    diff = "@@ -2 +2 @@\n-b\n+B\n"
    # Last line stays without newline; modified line gets one (our convention).
    assert apply_unified_diff(original, diff) == "a\nB\nc"


def test_apply_to_empty_file_via_insert():
    original = ""
    diff = "@@ -0,0 +1 @@\n+hello\n"
    assert apply_unified_diff(original, diff) == "hello\n"


def test_apply_noop_when_no_hunks():
    original = "a\nb\nc\n"
    assert apply_unified_diff(original, "") == "a\nb\nc\n"


# ---------- Apply failure modes ----------


def test_apply_raises_when_removed_line_doesnt_match():
    original = "a\nb\nc\n"
    # Claims line 2 is "X" but file actually has "b".
    diff = "@@ -2 +2 @@\n-X\n+B\n"
    with pytest.raises(DiffApplyError, match="Line 2 mismatch"):
        apply_unified_diff(original, diff)


def test_apply_raises_when_hunk_references_past_eof():
    original = "a\nb\n"  # only 2 lines
    diff = "@@ -5 +5 @@\n-z\n+Z\n"
    with pytest.raises(DiffApplyError, match="file only has"):
        apply_unified_diff(original, diff)


# ====================================================================
# UnifiedDiff op integration tests
# ====================================================================


def test_unified_diff_op_applies_to_data_repo_file(data_repo: Path):
    (data_repo / "notes.md").write_text("a\nb\nc\n")
    commit(data_repo)
    UnifiedDiff(
        path="notes.md", diff="@@ -2 +2 @@\n-b\n+B\n"
    ).apply(data_repo)
    assert (data_repo / "notes.md").read_text() == "a\nB\nc\n"


def test_unified_diff_op_rejects_missing_target(data_repo: Path):
    with pytest.raises(ApplyError, match="does not exist"):
        UnifiedDiff(
            path="ghost.md", diff="@@ -1 +1 @@\n-x\n+y\n"
        ).apply(data_repo)


def test_unified_diff_op_rejects_directory_target(data_repo: Path):
    (data_repo / "sub").mkdir()
    with pytest.raises(ApplyError, match="not a file"):
        UnifiedDiff(
            path="sub", diff="@@ -1 +1 @@\n-x\n+y\n"
        ).apply(data_repo)


def test_unified_diff_op_wraps_parse_error_as_apply_error(data_repo: Path):
    (data_repo / "notes.md").write_text("hello\n")
    commit(data_repo)
    with pytest.raises(ApplyError, match="parse error"):
        UnifiedDiff(
            path="notes.md", diff="@@ bad @@\n-x\n+y\n"
        ).apply(data_repo)


def test_unified_diff_op_wraps_apply_error_as_apply_error(data_repo: Path):
    (data_repo / "notes.md").write_text("a\nb\nc\n")
    commit(data_repo)
    with pytest.raises(ApplyError, match="apply failed"):
        UnifiedDiff(
            path="notes.md", diff="@@ -2 +2 @@\n-WRONG\n+B\n"
        ).apply(data_repo)
