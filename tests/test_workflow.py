"""Tests for jadelens.workflow."""

import json
import subprocess
from pathlib import Path

import pytest

from jadelens import workflow
from jadelens.operations import (
    ApplyError,
    CreateFile,
    DeletePath,
    JsonPatch,
    RenamePath,
    UnifiedDiff,
)
from jadelens.workflow import (
    BatchValidationError,
    WorkflowError,
    append_log_entry,
    git_commit,
    merge_unified_diffs,
    require_clean_tree,
    revert,
    validate_batch,
)
from tests.conftest import commit


# ====================================================================
# validate_batch
# ====================================================================


def test_validate_batch_empty_is_ok():
    validate_batch([])


def test_validate_batch_distinct_paths_ok():
    validate_batch(
        [
            CreateFile(path="a.json", content="{}"),
            DeletePath(path="b.json"),
            JsonPatch(path="c.json", patch=[]),
        ]
    )


def test_validate_batch_multiple_json_patches_same_path_ok():
    validate_batch(
        [
            JsonPatch(path="x.json", patch=[{"op": "add", "path": "/a", "value": 1}]),
            JsonPatch(path="x.json", patch=[{"op": "add", "path": "/b", "value": 2}]),
        ]
    )


def test_validate_batch_multiple_unified_diffs_same_path_ok():
    validate_batch(
        [
            UnifiedDiff(path="x.md", diff="@@ -1 +1 @@\n-a\n+A\n"),
            UnifiedDiff(path="x.md", diff="@@ -3 +3 @@\n-c\n+C\n"),
        ]
    )


def test_validate_batch_rejects_json_patch_and_unified_diff_same_path():
    with pytest.raises(BatchValidationError, match="incompatible"):
        validate_batch(
            [
                JsonPatch(path="x.json", patch=[]),
                UnifiedDiff(path="x.json", diff="@@ -1 +1 @@\n-a\n+A\n"),
            ]
        )


def test_validate_batch_rejects_unified_diff_and_create_same_path():
    with pytest.raises(BatchValidationError, match="incompatible"):
        validate_batch(
            [
                CreateFile(path="x.md", content="hi"),
                UnifiedDiff(path="x.md", diff="@@ -1 +1 @@\n-a\n+A\n"),
            ]
        )


def test_validate_batch_rejects_delete_and_json_patch_same_path():
    with pytest.raises(BatchValidationError, match="incompatible"):
        validate_batch(
            [
                JsonPatch(path="x.json", patch=[]),
                DeletePath(path="x.json"),
            ]
        )


def test_validate_batch_rejects_unified_diff_on_renamed_from_path():
    with pytest.raises(BatchValidationError, match="incompatible"):
        validate_batch(
            [
                RenamePath(from_path="old.md", to_path="new.md"),
                UnifiedDiff(path="old.md", diff="@@ -1 +1 @@\n-a\n+A\n"),
            ]
        )


def test_validate_batch_rejects_unified_diff_on_renamed_to_path():
    with pytest.raises(BatchValidationError, match="incompatible"):
        validate_batch(
            [
                RenamePath(from_path="old.md", to_path="new.md"),
                UnifiedDiff(path="new.md", diff="@@ -1 +1 @@\n-a\n+A\n"),
            ]
        )


def test_validate_batch_rejects_two_structure_ops_same_path():
    with pytest.raises(BatchValidationError, match="multiple structure ops"):
        validate_batch(
            [
                DeletePath(path="x.json"),
                CreateFile(path="x.json", content="{}"),
            ]
        )


def test_validate_batch_rejects_two_renames_sharing_a_path():
    """Two renames whose 'to' paths collide is a multi-structure case."""
    with pytest.raises(BatchValidationError, match="multiple structure ops"):
        validate_batch(
            [
                RenamePath(from_path="a.md", to_path="x.md"),
                RenamePath(from_path="b.md", to_path="x.md"),
            ]
        )


# ====================================================================
# merge_unified_diffs
# ====================================================================


def test_merge_no_unified_diffs_passes_through():
    ops = [CreateFile(path="a.json", content="{}"), DeletePath(path="b.json")]
    assert merge_unified_diffs(ops) == ops


def test_merge_single_unified_diff_per_path_passes_through():
    ops = [
        UnifiedDiff(path="x.md", diff="@@ -1 +1 @@\n-a\n+A\n"),
        UnifiedDiff(path="y.md", diff="@@ -2 +2 @@\n-b\n+B\n"),
    ]
    assert merge_unified_diffs(ops) == ops


def test_merge_combines_two_diffs_on_same_path():
    ops = [
        UnifiedDiff(path="x.md", diff="@@ -1 +1 @@\n-a\n+A\n"),
        UnifiedDiff(path="x.md", diff="@@ -3 +3 @@\n-c\n+C\n"),
    ]
    merged = merge_unified_diffs(ops)
    assert len(merged) == 1
    assert isinstance(merged[0], UnifiedDiff)
    assert merged[0].path == "x.md"
    assert "@@ -1 +1 @@" in merged[0].diff
    assert "@@ -3 +3 @@" in merged[0].diff


def test_merge_strips_preambles_when_combining():
    """Each diff's --- / +++ preamble is dropped during merge to keep the
    combined diff parseable (the parser only skips preamble at the top)."""
    ops = [
        UnifiedDiff(
            path="x.md",
            diff="--- a/x.md\n+++ b/x.md\n@@ -1 +1 @@\n-a\n+A\n",
        ),
        UnifiedDiff(
            path="x.md",
            diff="--- a/x.md\n+++ b/x.md\n@@ -3 +3 @@\n-c\n+C\n",
        ),
    ]
    merged = merge_unified_diffs(ops)
    # After merge, the body has both hunks but no second preamble in the middle.
    body = merged[0].diff
    assert body.count("---") == 0
    assert body.count("+++ b") == 0
    # Two hunks, each header has two "@@" markers (start and end).
    assert body.count("@@ -") == 2


def test_merge_preserves_order_of_other_ops():
    ops = [
        CreateFile(path="new.json", content="{}"),
        UnifiedDiff(path="x.md", diff="@@ -1 +1 @@\n-a\n+A\n"),
        DeletePath(path="stale.md"),
        UnifiedDiff(path="x.md", diff="@@ -3 +3 @@\n-c\n+C\n"),
        JsonPatch(path="y.json", patch=[]),
    ]
    merged = merge_unified_diffs(ops)
    types = [type(op).__name__ for op in merged]
    assert types == ["CreateFile", "UnifiedDiff", "DeletePath", "JsonPatch"]


# ====================================================================
# require_clean_tree
# ====================================================================


def test_require_clean_tree_passes_when_clean(data_repo: Path):
    require_clean_tree(data_repo)  # should not raise


def test_require_clean_tree_rejects_modified_tracked_file(data_repo: Path):
    (data_repo / ".seed").write_text("modified")
    with pytest.raises(WorkflowError, match="uncommitted changes"):
        require_clean_tree(data_repo)


def test_require_clean_tree_rejects_untracked_file(data_repo: Path):
    (data_repo / "new.txt").write_text("untracked")
    with pytest.raises(WorkflowError, match="uncommitted changes"):
        require_clean_tree(data_repo)


# ====================================================================
# append_log_entry
# ====================================================================


def test_append_log_entry_creates_file_if_missing(data_repo: Path):
    raw_ops = [{"op": "create_file", "path": "x", "content": "hi"}]
    append_log_entry(
        data_repo, raw_ops, "Add x", "2026-05-21T10:00:00+00:00"
    )
    log = data_repo / ".jade" / "operations-log.jsonl"
    assert log.is_file()
    entry = json.loads(log.read_text())
    assert entry == {
        "ts": "2026-05-21T10:00:00+00:00",
        "commit_message": "Add x",
        "operations": raw_ops,
    }


def test_append_log_entry_appends_to_existing(data_repo: Path):
    (data_repo / ".jade").mkdir()
    log = data_repo / ".jade" / "operations-log.jsonl"
    log.write_text(
        '{"ts": "earlier", "commit_message": "seed", "operations": []}\n'
    )
    append_log_entry(
        data_repo,
        [{"op": "delete_path", "path": "x"}],
        "Drop x",
        "2026-05-21T11:00:00+00:00",
    )
    lines = log.read_text().splitlines()
    assert len(lines) == 2
    second = json.loads(lines[1])
    assert second == {
        "ts": "2026-05-21T11:00:00+00:00",
        "commit_message": "Drop x",
        "operations": [{"op": "delete_path", "path": "x"}],
    }


# ====================================================================
# revert + git_commit
# ====================================================================


def test_revert_resets_modified_tracked_file(data_repo: Path):
    (data_repo / ".seed").write_text("modified")
    revert(data_repo)
    assert (data_repo / ".seed").read_text() == "seed\n"


def test_revert_removes_untracked_file(data_repo: Path):
    (data_repo / "new.txt").write_text("untracked")
    revert(data_repo)
    assert not (data_repo / "new.txt").exists()


def test_revert_undoes_staged_deletion(data_repo: Path):
    subprocess.run(
        ["git", "-C", str(data_repo), "rm", ".seed"],
        check=True, capture_output=True,
    )
    assert not (data_repo / ".seed").exists()
    revert(data_repo)
    assert (data_repo / ".seed").read_text() == "seed\n"


def test_git_commit_returns_sha(data_repo: Path):
    (data_repo / "new.txt").write_text("hello")
    sha = git_commit(data_repo, "test commit")
    assert len(sha) == 40
    # Verify message reached the commit.
    result = subprocess.run(
        ["git", "-C", str(data_repo), "log", "-1", "--format=%s"],
        capture_output=True, text=True, check=True,
    )
    assert result.stdout.strip() == "test commit"


# ====================================================================
# workflow.run — end-to-end
# ====================================================================


def test_run_happy_path_create_file(data_repo: Path):
    sha = workflow.run(
        data_repo,
        [{"op": "create_file", "path": "todos.json", "content": "[]\n"}],
        "Add empty todo list",
    )
    assert (data_repo / "todos.json").read_text() == "[]\n"
    # Log entry exists with the commit message inlined.
    log = data_repo / ".jade" / "operations-log.jsonl"
    assert log.is_file()
    entry = json.loads(log.read_text())
    assert entry["commit_message"] == "Add empty todo list"
    assert entry["operations"] == [
        {"op": "create_file", "path": "todos.json", "content": "[]\n"}
    ]
    # Commit captured everything (file + log).
    diff = subprocess.run(
        ["git", "-C", str(data_repo), "show", "--name-only", "--format=", sha],
        capture_output=True, text=True, check=True,
    )
    files = set(diff.stdout.split())
    assert files == {"todos.json", ".jade/operations-log.jsonl"}


def test_run_happy_path_mixed_ops(data_repo: Path):
    (data_repo / "old.md").write_text("hello\n")
    (data_repo / "data.json").write_text('{"items": []}\n')
    commit(data_repo)

    workflow.run(
        data_repo,
        [
            {"op": "create_file", "path": "new.md", "content": "# new\n"},
            {
                "op": "json_patch",
                "path": "data.json",
                "patch": [{"op": "add", "path": "/items/-", "value": "a"}],
            },
            {"op": "rename_path", "from": "old.md", "to": "renamed.md"},
        ],
        "Mixed ops",
    )
    assert (data_repo / "new.md").read_text() == "# new\n"
    assert json.loads((data_repo / "data.json").read_text()) == {"items": ["a"]}
    assert not (data_repo / "old.md").exists()
    assert (data_repo / "renamed.md").read_text() == "hello\n"


def test_run_merges_multiple_unified_diffs_on_same_file(data_repo: Path):
    """Two diffs on one file both reference the pre-batch (original) state.

    The first diff inserts 2 lines after line 2. The second diff replaces
    line 4 — line 4 of the ORIGINAL, which is 'd'. If the diffs were
    applied sequentially without merge, the first diff's inserts would
    have shifted 'd' to line 6 and the second diff's `-d` at line 4 would
    fail verification. Passing this test proves the merge happens.
    """
    (data_repo / "notes.md").write_text("a\nb\nc\nd\n")
    commit(data_repo)
    workflow.run(
        data_repo,
        [
            {
                "op": "unified_diff",
                "path": "notes.md",
                "diff": "@@ -2,0 +3,2 @@\n+X1\n+X2\n",
            },
            {
                "op": "unified_diff",
                "path": "notes.md",
                "diff": "@@ -4 +4 @@\n-d\n+D\n",
            },
        ],
        "Two diffs on one file",
    )
    assert (data_repo / "notes.md").read_text() == "a\nb\nX1\nX2\nc\nD\n"


def test_run_aborts_and_reverts_on_apply_failure(data_repo: Path):
    """An apply failure (e.g. create_file on existing path) must leave the
    data repo untouched."""
    (data_repo / "exists.json").write_text('{"original": true}')
    commit(data_repo)
    pre_sha = subprocess.run(
        ["git", "-C", str(data_repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()

    with pytest.raises(Exception, match="already exists"):
        workflow.run(
            data_repo,
            [
                {"op": "create_file", "path": "new.json", "content": "{}"},
                # This one fails — exists.json is already there. Its content
                # differs from the bot's so the assertion below confirms
                # the original wasn't clobbered.
                {"op": "create_file", "path": "exists.json", "content": '{"clobbered": true}'},
            ],
            "Should abort and revert",
        )

    # Repo state unchanged.
    post_sha = subprocess.run(
        ["git", "-C", str(data_repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert post_sha == pre_sha
    assert not (data_repo / "new.json").exists()
    assert (data_repo / "exists.json").read_text() == '{"original": true}'


def test_run_refuses_with_dirty_working_tree(data_repo: Path):
    (data_repo / "uncommitted.txt").write_text("change")
    with pytest.raises(WorkflowError, match="uncommitted changes"):
        workflow.run(
            data_repo,
            [{"op": "create_file", "path": "new.json", "content": "{}"}],
            "Should be refused",
        )
    # The uncommitted file is still there — we didn't clobber it.
    assert (data_repo / "uncommitted.txt").read_text() == "change"


# ---------------------- post-apply wikilink pass ----------------------


def test_rename_rewrites_external_wikilinks(data_repo: Path):
    (data_repo / "old.md").write_text("# original\n")
    (data_repo / "ref.md").write_text("see [[old.md]] for details\n")
    commit(data_repo)
    workflow.run(
        data_repo,
        [{"op": "rename_path", "from": "old.md", "to": "new.md"}],
        "Rename old → new",
    )
    assert (data_repo / "new.md").exists()
    assert (data_repo / "ref.md").read_text() == "see [[new.md]] for details\n"


def test_rename_rewrites_self_reference(data_repo: Path):
    """A file containing a wikilink to itself has that self-reference
    rewritten too — after the rename, the moved file's self-reference
    points at the new location."""
    (data_repo / "old.md").write_text("I am [[old.md]] looking at myself\n")
    commit(data_repo)
    workflow.run(
        data_repo,
        [{"op": "rename_path", "from": "old.md", "to": "new.md"}],
        "Rename with self-ref",
    )
    assert (
        (data_repo / "new.md").read_text()
        == "I am [[new.md]] looking at myself\n"
    )


def test_rename_then_explicit_diff_clobbers_auto_rewrite(data_repo: Path):
    """The bot can emit a unified_diff that explicitly rewrites a specific
    reference to something other than the rename's auto-target. Because
    the post-pass only sees what survived to the end of the batch, the
    explicit rewrite is honoured and the auto-rewrite doesn't trample it."""
    (data_repo / "old.md").write_text("# original\n")
    (data_repo / "ref.md").write_text("see [[old.md]] for details\n")
    commit(data_repo)
    workflow.run(
        data_repo,
        [
            {"op": "rename_path", "from": "old.md", "to": "new.md"},
            {
                "op": "unified_diff",
                "path": "ref.md",
                "diff": (
                    "@@ -1 +1 @@\n"
                    "-see [[old.md]] for details\n"
                    "+see [[something_else.md]] for details\n"
                ),
            },
        ],
        "Rename with explicit override",
    )
    assert (
        (data_repo / "ref.md").read_text()
        == "see [[something_else.md]] for details\n"
    )


def test_delete_rejects_when_external_references_remain(data_repo: Path):
    """If after applying all ops a wikilink still references the deleted
    path, the post-pass refuses and the whole batch reverts."""
    (data_repo / "doomed.md").write_text("# delete me\n")
    (data_repo / "ref.md").write_text("see [[doomed.md]] still here\n")
    commit(data_repo)
    with pytest.raises(ApplyError, match="still referenced by wikilinks"):
        workflow.run(
            data_repo,
            [{"op": "delete_path", "path": "doomed.md"}],
            "Should fail",
        )
    # Reverted — doomed.md is back, ref.md unchanged.
    assert (data_repo / "doomed.md").exists()
    assert (data_repo / "ref.md").read_text() == "see [[doomed.md]] still here\n"


def test_delete_succeeds_when_cleanup_diff_in_same_batch(data_repo: Path):
    """Bot can clean up references in the same batch via unified_diff —
    the order doesn't matter because the post-pass only sees the end
    state of the batch."""
    (data_repo / "doomed.md").write_text("# delete me\n")
    (data_repo / "ref.md").write_text("[[doomed.md]] is going away\n")
    commit(data_repo)
    workflow.run(
        data_repo,
        [
            {"op": "delete_path", "path": "doomed.md"},  # delete FIRST
            {
                "op": "unified_diff",
                "path": "ref.md",
                "diff": (
                    "@@ -1 +1 @@\n"
                    "-[[doomed.md]] is going away\n"
                    "+ was here, now gone\n"
                ),
            },
        ],
        "Delete + cleanup in one batch",
    )
    assert not (data_repo / "doomed.md").exists()
    assert (data_repo / "ref.md").read_text() == " was here, now gone\n"


def test_delete_rejects_when_new_file_references_deleted(data_repo: Path):
    """Nice property of the deferred pass: bot can't accidentally delete
    a file in one op and then create a new file referencing it in a
    later op of the same batch — the scan catches it at the end."""
    (data_repo / "doomed.md").write_text("# delete me\n")
    commit(data_repo)
    with pytest.raises(ApplyError, match="still referenced by wikilinks"):
        workflow.run(
            data_repo,
            [
                {"op": "delete_path", "path": "doomed.md"},
                {
                    "op": "create_file",
                    "path": "new.md",
                    "content": "I reference [[doomed.md]] in my fresh file\n",
                },
            ],
            "Self-inconsistent batch",
        )
    # Reverted: doomed.md back, new.md never created.
    assert (data_repo / "doomed.md").exists()
    assert not (data_repo / "new.md").exists()


def test_delete_doesnt_count_references_from_inside_deleted_dir(
    data_repo: Path,
):
    """References from files inside the deleted directory don't count —
    those files are gone by the time the scan runs."""
    (data_repo / "doomed").mkdir()
    (data_repo / "doomed" / "a.md").write_text("[[doomed/b.md]] inside\n")
    (data_repo / "doomed" / "b.md").write_text("# b\n")
    commit(data_repo)
    workflow.run(
        data_repo,
        [{"op": "delete_path", "path": "doomed"}],
        "Delete whole dir with internal refs",
    )
    assert not (data_repo / "doomed").exists()


# ---------------------- end of post-apply wikilink pass section ----------------------


def test_run_rejects_invalid_batch(data_repo: Path):
    with pytest.raises(BatchValidationError):
        workflow.run(
            data_repo,
            [
                {"op": "create_file", "path": "x.json", "content": "{}"},
                {"op": "delete_path", "path": "x.json"},
            ],
            "Conflicting batch",
        )
    # No commit was created.
    assert not (data_repo / "x.json").exists()
