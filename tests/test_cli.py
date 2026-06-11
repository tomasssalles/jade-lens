"""Tests for jadelens.cli helpers (non-interactive parts)."""

import json
import stat
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

from jadelens.cli import (
    _collect_config,
    _update_repo,
    _write_common_files,
    do_post_update,
    do_render_skill,
    do_update,
)


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
    assert "<!-- jade-lens-skill cli-version=" in content


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


# ---------------------- do_update ----------------------


def test_update_is_thin_shim():
    """update must always be exactly two subprocess.run calls and nothing else.

    This test is intentionally strict: any logic added to do_update() will
    break it. All update work belongs in post-update, not here.
    """
    with patch("jadelens.cli.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        do_update()

    assert mock_run.call_count == 2, (
        "do_update() must make exactly two subprocess.run calls"
    )
    first_cmd = mock_run.call_args_list[0][0][0]
    second_cmd = mock_run.call_args_list[1][0][0]
    assert first_cmd[0] == "uv", "first call must invoke uv"
    assert "install" in first_cmd or "upgrade" in first_cmd, (
        "first call must be a uv install/upgrade"
    )
    assert second_cmd == ["jadelens", "post-update"], (
        "second call must be 'jadelens post-update' with no extra arguments"
    )


# ---------------------- _collect_config ----------------------


def test_collect_config_returns_all_known():
    """When all fields are already known, no prompting occurs."""
    known = {
        "user": {"full_name": "Alice Smith", "short_name": "Alice"},
        "assistant": {"name": "jade"},
    }
    result = _collect_config(known)
    assert result == known


def test_collect_config_prompts_for_missing_fields(monkeypatch):
    """Missing fields trigger the appropriate prompts."""
    responses = iter(["myassistant", "Alice Smith", "Alice"])
    monkeypatch.setattr("builtins.input", lambda _: next(responses))
    # Suppress git config lookup
    monkeypatch.setattr("jadelens.cli._git_config_user_name", lambda _: "")

    result = _collect_config({})

    assert result["assistant"]["name"] == "myassistant"
    assert result["user"]["full_name"] == "Alice Smith"
    assert result["user"]["short_name"] == "Alice"


def test_collect_config_does_not_reprompt_assistant_name(monkeypatch):
    """assistant.name already in known is not re-prompted."""
    responses = iter(["Alice Smith", "Alice"])
    monkeypatch.setattr("builtins.input", lambda _: next(responses))
    monkeypatch.setattr("jadelens.cli._git_config_user_name", lambda _: "")

    result = _collect_config({"assistant": {"name": "jade"}})

    assert result["assistant"]["name"] == "jade"
    assert result["user"]["full_name"] == "Alice Smith"


# ---------------------- _write_common_files ----------------------


def test_write_common_files_creates_all_files(tmp_path: Path):
    config = {"user": {"full_name": "Alice", "short_name": "Alice"}, "assistant": {"name": "jade"}}
    _write_common_files(tmp_path, config)

    assert (tmp_path / ".jade" / "config.json").is_file()
    assert (tmp_path / ".claude" / "hooks" / "session-start").is_file()
    assert (tmp_path / ".claude" / "settings.json").is_file()
    assert (tmp_path / "CLAUDE.md").is_file()
    assert (tmp_path / ".gitignore").is_file()


def test_write_common_files_returns_five_paths(tmp_path: Path):
    config = {"user": {"full_name": "Alice", "short_name": "Alice"}, "assistant": {"name": "jade"}}
    paths = _write_common_files(tmp_path, config)
    assert len(paths) == 5
    assert all(p.is_file() for p in paths)


def test_write_common_files_hook_is_executable(tmp_path: Path):
    config = {"user": {"full_name": "Alice", "short_name": "Alice"}, "assistant": {"name": "jade"}}
    _write_common_files(tmp_path, config)
    hook = tmp_path / ".claude" / "hooks" / "session-start"
    assert hook.stat().st_mode & stat.S_IXUSR


def test_write_common_files_config_json_content(tmp_path: Path):
    config = {"user": {"full_name": "Alice", "short_name": "Alice"}, "assistant": {"name": "jade"}}
    _write_common_files(tmp_path, config)
    written = json.loads((tmp_path / ".jade" / "config.json").read_text())
    assert written == config


def test_write_common_files_overwrites_existing(tmp_path: Path):
    """Calling twice with different config overwrites — no-op-if-exists semantics are wrong here."""
    config1 = {"user": {"full_name": "Alice", "short_name": "Alice"}, "assistant": {"name": "jade"}}
    config2 = {"user": {"full_name": "Bob", "short_name": "Bob"}, "assistant": {"name": "jade"}}
    _write_common_files(tmp_path, config1)
    _write_common_files(tmp_path, config2)
    written = json.loads((tmp_path / ".jade" / "config.json").read_text())
    assert written["user"]["full_name"] == "Bob"


def test_write_common_files_does_not_write_skill(tmp_path: Path):
    config = {"user": {"full_name": "Alice", "short_name": "Alice"}, "assistant": {"name": "jade"}}
    _write_common_files(tmp_path, config)
    assert not (tmp_path / ".claude" / "skills").exists()


# ---------------------- _update_repo ----------------------

VALID_CONFIG = {
    "user": {"full_name": "Test User", "short_name": "Test"},
    "assistant": {"name": "testskill"},
}


def _make_git_repo(path: Path) -> None:
    """Initialise a bare-minimum git repo suitable for _update_repo tests."""
    subprocess.run(["git", "init", str(path)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(path), "config", "user.email", "test@example.com"],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(path), "config", "user.name", "Test"],
        check=True, capture_output=True,
    )
    # Add a remote pointing at a local bare repo so push works
    bare = path.parent / (path.name + "-bare")
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(path), "remote", "add", "origin", str(bare)],
        check=True, capture_output=True,
    )


def _seed_repo(path: Path, skill_cli_version: str) -> None:
    """Write the minimum files needed, commit them, and render the skill."""
    from jadelens import __version__
    from jadelens.cli import _write_common_files, do_render_skill
    from jadelens.operations import dumps_js_canonical

    _make_git_repo(path)
    _write_common_files(path, VALID_CONFIG)
    (path / ".jade" / "version").write_text("v1\n")
    (path / "Index.json").write_text(dumps_js_canonical([]))

    # Render skill then patch the marker to the requested version
    do_render_skill(path)
    skill_path = path / ".claude" / "skills" / "testskill" / "SKILL.md"
    original = skill_path.read_text()
    patched = original.replace(
        f"cli-version={__version__}", f"cli-version={skill_cli_version}"
    )
    skill_path.write_text(patched)

    subprocess.run(
        ["git", "-C", str(path), "add", "-A"], check=True, capture_output=True
    )
    subprocess.run(
        ["git", "-C", str(path), "commit", "-m", "initial"],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(path), "push", "-u", "origin", "HEAD:main"],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(path), "checkout", "-B", "main"],
        check=True, capture_output=True,
    )


def test_update_repo_idempotent_when_version_matches(tmp_path: Path, capsys):
    from jadelens import __version__
    repo = tmp_path / "repo"
    repo.mkdir()
    _seed_repo(repo, __version__)
    _update_repo(repo)
    out = capsys.readouterr().out
    assert "Already up to date" in out


def test_update_repo_aborts_on_dirty_tree(tmp_path: Path):
    from jadelens import __version__
    repo = tmp_path / "repo"
    repo.mkdir()
    _seed_repo(repo, "v0.0.0")  # stale version → not idempotent
    (repo / "dirty.txt").write_text("uncommitted")
    with pytest.raises(SystemExit, match="uncommitted changes"):
        _update_repo(repo)


def test_update_repo_updates_files_and_rerenders(tmp_path: Path):
    from jadelens import __version__
    repo = tmp_path / "repo"
    repo.mkdir()
    _seed_repo(repo, "v0.0.0")

    # Verify skill has old marker before update
    skill = repo / ".claude" / "skills" / "testskill" / "SKILL.md"
    assert "cli-version=v0.0.0" in skill.read_text()

    _update_repo(repo)

    # Skill should now carry the current version
    assert f"cli-version={__version__}" in skill.read_text()


def test_update_repo_idempotent_on_second_run(tmp_path: Path, capsys):
    from jadelens import __version__
    repo = tmp_path / "repo"
    repo.mkdir()
    _seed_repo(repo, "v0.0.0")

    _update_repo(repo)
    capsys.readouterr()  # discard first run output

    _update_repo(repo)
    out = capsys.readouterr().out
    assert "Already up to date" in out


# ---------------------- do_post_update (multi-repo scan) ----------------------


def _make_skill_symlink(skills_dir: Path, data_repo: Path, assistant_name: str) -> None:
    """Create ~/.claude/skills/<name> → <data_repo>/.claude/skills/<name> symlink."""
    target = data_repo / ".claude" / "skills" / assistant_name
    target.mkdir(parents=True, exist_ok=True)
    skills_dir.mkdir(parents=True, exist_ok=True)
    (skills_dir / assistant_name).symlink_to(target)


def test_post_update_no_skills_dir(tmp_path: Path, capsys):
    do_post_update(None, skills_dir=tmp_path / "nonexistent")
    assert "Nothing to update" in capsys.readouterr().out


def test_post_update_skips_non_symlinks(tmp_path: Path, capsys):
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    (skills_dir / "not-a-symlink").mkdir()  # regular dir, not a symlink
    do_post_update(None, skills_dir=skills_dir)
    assert "Nothing to update" in capsys.readouterr().out


def test_post_update_skips_broken_symlink(tmp_path: Path, capsys):
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    (skills_dir / "broken").symlink_to(tmp_path / "does-not-exist")
    do_post_update(None, skills_dir=skills_dir)
    out = capsys.readouterr().out
    assert "broken" in out.lower()
    assert "Nothing to update" in out


def test_post_update_skips_non_jade_skill(tmp_path: Path, capsys):
    skills_dir = tmp_path / "skills"
    target_dir = tmp_path / "other-skill"
    target_dir.mkdir(parents=True)
    (target_dir / "SKILL.md").write_text("# Some other skill\nNo jade marker here.\n")
    (skills_dir).mkdir()
    (skills_dir / "other").symlink_to(target_dir)
    do_post_update(None, skills_dir=skills_dir)
    assert "Nothing to update" in capsys.readouterr().out


def test_post_update_symlink_points_at_directory_not_file(tmp_path: Path):
    """The multi-repo scan contract: symlink → directory, not SKILL.md.

    Path derivation (target.parents[2]) only works when the symlink target
    is <data_repo>/.claude/skills/<name> (a directory), not the SKILL.md
    file inside it. This test encodes that contract explicitly.
    """
    skills_dir = tmp_path / "skills"
    data_repo = tmp_path / "repo"
    data_repo.mkdir()
    _seed_repo(data_repo, "v0.0.0")  # creates the skill dir

    skill_dir = data_repo / ".claude" / "skills" / "testskill"
    skills_dir.mkdir()
    symlink = skills_dir / "testskill"
    symlink.symlink_to(skill_dir)

    # The symlink target is a directory
    assert symlink.resolve().is_dir()
    # Path derivation from the directory gives back the data_repo
    assert symlink.resolve().parents[2] == data_repo


def test_post_update_multi_repo_updates_all(tmp_path: Path, capsys):
    from jadelens import __version__
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()

    for name in ("repo1", "repo2"):
        repo = tmp_path / name
        repo.mkdir()
        _seed_repo(repo, "v0.0.0")
        skill_dir = repo / ".claude" / "skills" / "testskill"
        (skills_dir / f"testskill-{name}").symlink_to(skill_dir)

    do_post_update(None, skills_dir=skills_dir)

    for name in ("repo1", "repo2"):
        skill = tmp_path / name / ".claude" / "skills" / "testskill" / "SKILL.md"
        assert f"cli-version={__version__}" in skill.read_text(), name