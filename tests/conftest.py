"""Shared pytest fixtures."""

import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def data_repo(tmp_path: Path) -> Path:
    """Initialise a git repo with the same `.jade/` scaffolding a real
    data repo carries (version, empty index, operations-log directory),
    plus a seed file and one initial commit. Returns the repo path.

    Mirrors what the user manually sets up for v0.1.0 (DESIGN.md §7.2):
    `.jade/version` holds the data-repo version string (`v0.1.0`),
    `.jade/index.json` starts as `{}` (bot fills in over time), and
    `.jade/operations-log/` will hold one append-only JSONL file per
    data-repo version.
    """
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "user.email", "test@example.com"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "user.name", "Test"],
        check=True,
    )
    jade_dir = tmp_path / ".jade"
    jade_dir.mkdir()
    (jade_dir / "version").write_text("v0.1.0\n")
    (jade_dir / "index.json").write_text("{}\n")
    # operations-log/ directory is created by workflow.append_log_entry as
    # needed; git doesn't track empty dirs so we don't pre-create it here.
    (tmp_path / ".seed").write_text("seed\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "commit", "-q", "-m", "seed"],
        check=True,
    )
    return tmp_path


def commit(data_repo: Path, message: str = "snapshot") -> None:
    """Helper: stage everything in ``data_repo`` and commit."""
    subprocess.run(["git", "-C", str(data_repo), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(data_repo), "commit", "-q", "-m", message],
        check=True,
    )