"""Tests for the apply methods of CreateFile, DeletePath, RenamePath."""

import subprocess
from pathlib import Path

import pytest

from jadelens.operations import ApplyError, CreateFile, DeletePath, RenamePath
from tests.conftest import commit


# ---------------------- CreateFile ----------------------


def test_create_file_writes_content(data_repo: Path):
    CreateFile(path="todo.json", content="[]\n").apply(data_repo)
    assert (data_repo / "todo.json").read_text() == "[]\n"


def test_create_file_creates_missing_parents(data_repo: Path):
    CreateFile(
        path="projects/leasing/notes.md", content="# notes\n"
    ).apply(data_repo)
    assert (data_repo / "projects" / "leasing" / "notes.md").read_text() == "# notes\n"


def test_create_file_rejects_if_target_exists(data_repo: Path):
    (data_repo / "exists.txt").write_text("original")
    with pytest.raises(ApplyError, match="already exists"):
        CreateFile(path="exists.txt", content="new").apply(data_repo)
    # Original untouched.
    assert (data_repo / "exists.txt").read_text() == "original"


# ---------------------- DeletePath ----------------------


def test_delete_path_removes_single_file(data_repo: Path):
    (data_repo / "todo.json").write_text("[]")
    commit(data_repo)
    DeletePath(path="todo.json").apply(data_repo)
    assert not (data_repo / "todo.json").exists()


def test_delete_path_recursive_directory(data_repo: Path):
    (data_repo / "sub").mkdir()
    (data_repo / "sub" / "a.txt").write_text("a")
    (data_repo / "sub" / "b.txt").write_text("b")
    (data_repo / "sub" / "nested").mkdir()
    (data_repo / "sub" / "nested" / "c.txt").write_text("c")
    commit(data_repo)
    DeletePath(path="sub").apply(data_repo)
    assert not (data_repo / "sub").exists()


def test_delete_path_rejects_missing(data_repo: Path):
    with pytest.raises(ApplyError, match="does not exist"):
        DeletePath(path="ghost.txt").apply(data_repo)


def test_delete_path_stages_deletion_in_git(data_repo: Path):
    (data_repo / "doomed.txt").write_text("bye")
    commit(data_repo)
    DeletePath(path="doomed.txt").apply(data_repo)
    # git status should show the deletion staged.
    result = subprocess.run(
        ["git", "-C", str(data_repo), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "D  doomed.txt" in result.stdout


# ---------------------- RenamePath ----------------------


def test_rename_path_file(data_repo: Path):
    (data_repo / "old.txt").write_text("hi")
    commit(data_repo)
    RenamePath(from_path="old.txt", to_path="new.txt").apply(data_repo)
    assert not (data_repo / "old.txt").exists()
    assert (data_repo / "new.txt").read_text() == "hi"


def test_rename_path_directory(data_repo: Path):
    (data_repo / "old").mkdir()
    (data_repo / "old" / "a.txt").write_text("a")
    (data_repo / "old" / "b.txt").write_text("b")
    commit(data_repo)
    RenamePath(from_path="old", to_path="new").apply(data_repo)
    assert not (data_repo / "old").exists()
    assert (data_repo / "new" / "a.txt").read_text() == "a"
    assert (data_repo / "new" / "b.txt").read_text() == "b"


def test_rename_path_rejects_missing_source(data_repo: Path):
    with pytest.raises(ApplyError, match="source does not exist"):
        RenamePath(from_path="ghost.txt", to_path="new.txt").apply(data_repo)


def test_rename_path_rejects_existing_target(data_repo: Path):
    (data_repo / "a.txt").write_text("a")
    (data_repo / "b.txt").write_text("b")
    commit(data_repo)
    with pytest.raises(ApplyError, match="target already exists"):
        RenamePath(from_path="a.txt", to_path="b.txt").apply(data_repo)


def test_rename_path_into_new_directory(data_repo: Path):
    """git mv can move a file into a new directory tree."""
    (data_repo / "file.txt").write_text("hi")
    commit(data_repo)
    RenamePath(
        from_path="file.txt", to_path="nested/dir/file.txt"
    ).apply(data_repo)
    assert (data_repo / "nested" / "dir" / "file.txt").read_text() == "hi"


def test_rename_path_rejects_file_suffix_change(data_repo: Path):
    """Renaming a .md to a .json would mis-classify the file under our
    op-vs-suffix rules."""
    (data_repo / "notes.md").write_text("# notes\n")
    commit(data_repo)
    with pytest.raises(ApplyError, match="suffix must be preserved"):
        RenamePath(from_path="notes.md", to_path="notes.json").apply(data_repo)


def test_rename_path_directory_suffixes_dont_matter(data_repo: Path):
    """Directory renames aren't subject to the suffix-preservation rule."""
    (data_repo / "projects.v1").mkdir()
    (data_repo / "projects.v1" / "a.md").write_text("a")
    commit(data_repo)
    # 'projects.v1' has suffix '.v1'; rename to 'projects' (no suffix) is fine.
    RenamePath(from_path="projects.v1", to_path="projects").apply(data_repo)
    assert (data_repo / "projects" / "a.md").read_text() == "a"