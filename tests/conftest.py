"""Shared pytest fixtures."""

import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def data_repo(tmp_path: Path) -> Path:
    """Initialise an empty git repo with one seed commit, return its path.

    Many operation tests need a real git repo to operate on so that
    `git rm` / `git mv` succeed.
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
    (tmp_path / ".seed").write_text("seed\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", ".seed"], check=True)
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