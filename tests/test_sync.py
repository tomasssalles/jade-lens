"""Tests for jadelens.sync — the /jade auto-sync + conflict/stash flow against
real git clones sharing a bare 'remote'."""

import json
import subprocess
from pathlib import Path

import pytest

from jadelens import sync, workflow


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
    ).stdout


def _config(repo: Path) -> None:
    for k, v in (("user.email", "t@e.st"), ("user.name", "T"), ("commit.gpgsign", "false")):
        _git(repo, "config", k, v)


@pytest.fixture
def repos(tmp_path: Path):
    """A bare remote + clone A seeded with .jade scaffolding and one file.
    Returns (remote, A, clone) where `clone` makes further clones."""
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", "-b", "main", str(remote)], check=True)

    def clone(name: str) -> Path:
        w = tmp_path / name
        subprocess.run(["git", "clone", "-q", str(remote), str(w)], check=True)
        _config(w)
        return w

    a = clone("A")
    (a / ".jade").mkdir()
    (a / ".jade" / "version").write_text("v0.1.0\n")
    (a / "notes.md").write_text("base\n")
    _git(a, "add", "-A")
    _git(a, "commit", "-q", "-m", "seed")
    _git(a, "push", "-q", "origin", "HEAD:main")
    return remote, a, clone


def _edit_notes(text: str):
    return [{"op": "unified_diff", "path": "notes.md", "diff": f"@@ -1,1 +1,1 @@\n-base\n+{text}\n"}]


def test_push_succeeds_when_remote_unchanged(repos):
    _remote, a, _clone = repos
    workflow.run(a, [{"op": "create_file", "path": "x.md", "content": "x\n"}], "add x")
    assert sync.push(a).action == "pushed"
    # The remote now has x.md.
    assert "x.md" in _git(a, "ls-tree", "-r", "--name-only", "origin/main")


def test_pull_fast_forwards_a_behind_clone(repos):
    _remote, a, clone = repos
    b = clone("B")  # B is level with the seed
    workflow.run(a, [{"op": "unified_diff", "path": "notes.md",
                      "diff": "@@ -1,1 +1,1 @@\n-base\n+from-A\n"}], "A edits notes")
    sync.push(a)

    result = sync.pull(b)
    assert result.action == "fast-forwarded"
    assert (b / "notes.md").read_text() == "from-A\n"


def test_disjoint_changes_rebase_and_push(repos):
    _remote, a, clone = repos
    b = clone("B")
    # A adds fileA and pushes; B adds fileB without pulling → diverged.
    workflow.run(a, [{"op": "create_file", "path": "fileA.md", "content": "A\n"}], "A adds fileA")
    sync.push(a)
    workflow.run(b, [{"op": "create_file", "path": "fileB.md", "content": "B\n"}], "B adds fileB")

    result = sync.push(b)
    assert result.action == "rebased"
    assert result.stashed == 0
    # Remote has both files; the ops-log union-merged both lines.
    tree = _git(b, "ls-tree", "-r", "--name-only", "origin/main")
    assert "fileA.md" in tree and "fileB.md" in tree
    log = (b / ".jade" / "operations-log" / "v0.1.0.jsonl").read_text().splitlines()
    assert len(log) == 2


def test_same_file_conflict_is_stashed(repos):
    _remote, a, clone = repos
    b = clone("B")
    # Both edit notes.md from the same base → file-level conflict.
    workflow.run(a, _edit_notes("from-A"), "A edits notes")
    sync.push(a)
    workflow.run(b, _edit_notes("from-B"), "B edits notes")

    result = sync.push(b)
    assert result.action == "stashed"
    assert result.stashed == 1

    # Remote won: B's working notes.md is A's version, B's edit is gone.
    assert (b / "notes.md").read_text() == "from-A\n"

    # A self-contained stash entry was written with B's op + the pristine ancestor.
    stash_dir = b / ".jade" / "stash"
    entries = list(stash_dir.glob("*.json"))
    assert len(entries) == 1
    entry = json.loads(entries[0].read_text())
    assert entry["operations"] == _edit_notes("from-B")
    assert entry["ancestors"] == {"notes.md": "base\n"}

    # The stashed batch never reached the synced ops-log (only A's line is there).
    log = (b / ".jade" / "operations-log" / "v0.1.0.jsonl").read_text().splitlines()
    assert len(log) == 1
    assert json.loads(log[0])["commit_message"] == "A edits notes"

    # The stash commit is on the remote too.
    assert sync.push  # sanity
    remote_tree = _git(b, "ls-tree", "-r", "--name-only", "origin/main")
    assert ".jade/stash/" in remote_tree


def test_push_is_local_only_without_a_remote(tmp_path: Path):
    repo = tmp_path / "solo"
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    _config(repo)
    (repo / ".jade").mkdir()
    (repo / ".jade" / "version").write_text("v0.1.0\n")
    (repo / "f.md").write_text("x\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "seed")
    assert sync.push(repo).action == "local-only"
    assert sync.pull(repo).action == "local-only"
