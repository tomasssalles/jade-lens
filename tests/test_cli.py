"""Tests for jadelens.cli helpers (non-interactive parts)."""

import json
from pathlib import Path

import pytest

from jadelens.cli import do_render_skill


VALID_CONFIG = {
    "user": {"full_name": "Test User", "short_name": "Test"},
    "assistant": {"name": "testskill"},
}


def _write_config(data_repo: Path, config: dict) -> None:
    (data_repo / ".jade").mkdir(parents=True, exist_ok=True)
    (data_repo / ".jade" / "config.json").write_text(json.dumps(config))


# ---------------------- do_render_skill ----------------------


def test_render_skill_writes_file(tmp_path: Path):
    _write_config(tmp_path, VALID_CONFIG)

    do_render_skill(tmp_path)

    skill_path = tmp_path / ".claude" / "skills" / "testskill" / "SKILL.md"
    assert skill_path.is_file()
    content = skill_path.read_text()
    assert "Test User" in content
    assert "Test" in content
    assert "<!-- jade-lens-skill template-version=v" in content


def test_render_skill_noop_if_exists(tmp_path: Path):
    _write_config(tmp_path, VALID_CONFIG)
    skill_path = tmp_path / ".claude" / "skills" / "testskill" / "SKILL.md"
    skill_path.parent.mkdir(parents=True)
    skill_path.write_text("PRE-EXISTING CONTENT")

    do_render_skill(tmp_path)

    assert skill_path.read_text() == "PRE-EXISTING CONTENT"


def test_render_skill_creates_parent_dirs(tmp_path: Path):
    _write_config(tmp_path, VALID_CONFIG)
    # No .claude/ exists yet — render should mkdir -p.
    assert not (tmp_path / ".claude").exists()

    do_render_skill(tmp_path)

    assert (tmp_path / ".claude" / "skills" / "testskill" / "SKILL.md").is_file()


def test_render_skill_missing_config_file_exits(tmp_path: Path):
    with pytest.raises(SystemExit, match="Missing config file"):
        do_render_skill(tmp_path)


def test_render_skill_invalid_data_repo_exits(tmp_path: Path):
    with pytest.raises(SystemExit, match="is not a directory"):
        do_render_skill(tmp_path / "does-not-exist")


def test_render_skill_invalid_json_exits(tmp_path: Path):
    (tmp_path / ".jade").mkdir()
    (tmp_path / ".jade" / "config.json").write_text("not valid json {")

    with pytest.raises(SystemExit, match="Invalid JSON"):
        do_render_skill(tmp_path)


def test_render_skill_missing_assistant_name_exits(tmp_path: Path):
    _write_config(tmp_path, {"user": {"full_name": "x", "short_name": "x"}})

    with pytest.raises(SystemExit, match="Missing or malformed required field"):
        do_render_skill(tmp_path)


def test_render_skill_missing_user_full_name_exits(tmp_path: Path):
    _write_config(tmp_path, {
        "user": {"short_name": "x"},
        "assistant": {"name": "x"},
    })

    with pytest.raises(SystemExit, match="Missing or malformed required field"):
        do_render_skill(tmp_path)


def test_render_skill_missing_user_short_name_exits(tmp_path: Path):
    _write_config(tmp_path, {
        "user": {"full_name": "x"},
        "assistant": {"name": "x"},
    })

    with pytest.raises(SystemExit, match="Missing or malformed required field"):
        do_render_skill(tmp_path)


def test_render_skill_empty_field_exits(tmp_path: Path):
    """Empty strings violate Config's post-init validation; bubble it up."""
    _write_config(tmp_path, {
        "user": {"full_name": "", "short_name": "Test"},
        "assistant": {"name": "x"},
    })

    with pytest.raises(SystemExit, match="Invalid config"):
        do_render_skill(tmp_path)