"""Tests for the `jadelens stash <repo> --list` / `--resolve <id>` commands."""

import subprocess
from pathlib import Path

from jadelens.cli import do_stash_list, do_stash_resolve
from jadelens.stash import serialize_stash_entry, stash_filename

TS = "2026-06-01T14:30:22.000000+00:00"


def _add_stash(data_repo: Path, ops, ts=TS) -> str:
    from jadelens.stash import build_stash_entry

    rel = stash_filename(ts, "a1b2c3d4")
    target = data_repo / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(serialize_stash_entry(build_stash_entry(ops, ts, {})))
    subprocess.run(["git", "-C", str(data_repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(data_repo), "commit", "-q", "-m", "stash"], check=True)
    return Path(rel).stem


def test_stash_list_empty(data_repo, capsys):
    do_stash_list(data_repo)
    assert "No stashed changes." in capsys.readouterr().out


def test_stash_list_shows_entries_with_descriptions(data_repo, capsys):
    stash_id = _add_stash(data_repo, [{"op": "create_file", "path": "new.md", "content": "x\n"}])
    do_stash_list(data_repo)
    out = capsys.readouterr().out
    assert stash_id in out
    assert "Created new.md" in out


def test_stash_resolve_deletes_the_entry(data_repo, capsys):
    stash_id = _add_stash(data_repo, [{"op": "delete_path", "path": "gone.md"}])
    assert (data_repo / ".jade" / "stash" / f"{stash_id}.json").exists()

    do_stash_resolve(data_repo, stash_id)

    assert not (data_repo / ".jade" / "stash" / f"{stash_id}.json").exists()
    assert "Resolved stash entry" in capsys.readouterr().out
    # Recorded as a commit (bookkeeping); no longer listed.
    do_stash_list(data_repo)
    assert "No stashed changes." in capsys.readouterr().out


def test_stash_resolve_unknown_id_exits(data_repo):
    import pytest

    with pytest.raises(SystemExit):
        do_stash_resolve(data_repo, "nope-12345678")
