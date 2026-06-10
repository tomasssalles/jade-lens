"""Tests for the auto-sync integration in ``jadelens apply`` (pull-before /
push-after) and the stash note."""

import io
import json
import subprocess
import sys
from pathlib import Path

from jadelens import sync
from jadelens.apply import do_apply


def run_apply(monkeypatch, repo: Path, payload: dict) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(payload)))
    do_apply(repo)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
    ).stdout


def test_apply_pushes_after_commit(monkeypatch, tmp_path, capsys):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", "-b", "main", str(remote)], check=True)
    repo = tmp_path / "work"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True)
    for k, v in (("user.email", "t@e.st"), ("user.name", "T"), ("commit.gpgsign", "false")):
        _git(repo, "config", k, v)
    (repo / ".jade").mkdir()
    (repo / ".jade" / "version").write_text("v0.1.0\n")
    (repo / "seed.md").write_text("s\n")
    (repo / "Index.json").write_text('[\n  {\n    "File": "[[seed.md]]",\n    "Scope": "Seed"\n  }\n]\n')
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "seed")
    _git(repo, "push", "-q", "origin", "HEAD:main")

    run_apply(monkeypatch, repo, {
        "commit_message": "add note",
        "operations": [{"op": "create_file", "path": "note.md", "content": "n\n", "indexed": True, "scope": "Note"}],
    })

    out = capsys.readouterr().out
    assert "could not sync" not in out
    # The new file reached the remote.
    assert "note.md" in _git(repo, "ls-tree", "-r", "--name-only", "origin/main")


def test_apply_works_local_only_without_remote(monkeypatch, data_repo, capsys):
    run_apply(monkeypatch, data_repo, {
        "commit_message": "add note",
        "operations": [{"op": "create_file", "path": "note.md", "content": "n\n", "indexed": True, "scope": "Note"}],
    })
    out = capsys.readouterr().out
    assert "could not sync" not in out
    assert (data_repo / "note.md").read_text() == "n\n"
    # Committed locally.
    assert "add note" in _git(data_repo, "log", "-1", "--format=%s")


def test_apply_reports_a_stashed_conflict(monkeypatch, data_repo, capsys):
    # Isolate the apply branch: real local commit, but a stashed push outcome.
    monkeypatch.setattr(sync, "pull", lambda repo: sync.SyncResult("up-to-date"))
    monkeypatch.setattr(sync, "push", lambda repo: sync.SyncResult("stashed", 1))

    run_apply(monkeypatch, data_repo, {
        "commit_message": "add note",
        "operations": [{"op": "create_file", "path": "note.md", "content": "n\n", "indexed": True, "scope": "Note"}],
    })
    out = capsys.readouterr().out
    assert "stashed for review" in out


def test_apply_notes_a_deferred_sync_failure(monkeypatch, data_repo, capsys):
    monkeypatch.setattr(sync, "pull", lambda repo: sync.SyncResult("up-to-date"))

    def boom(repo):
        raise sync.SyncError("network down")

    monkeypatch.setattr(sync, "push", boom)
    run_apply(monkeypatch, data_repo, {
        "commit_message": "add note",
        "operations": [{"op": "create_file", "path": "note.md", "content": "n\n", "indexed": True, "scope": "Note"}],
    })
    out = capsys.readouterr().out
    assert "could not sync" in out
    # The change is still committed locally despite the sync failure.
    assert (data_repo / "note.md").read_text() == "n\n"
