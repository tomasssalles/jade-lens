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


# ---------------------- apply version guard ----------------------


import io
import sys as _sys

from jadelens.apply import do_apply


def _make_apply_payload() -> dict:
    return {
        "commit_message": "test",
        "operations": [{"op": "create_file", "path": "foo.md", "content": "hi"}],
    }


def test_apply_version_guard_aborts_if_skill_behind(tmp_path: Path, monkeypatch):
    """CLI ahead of skill → post-update message."""
    from jadelens import __version__
    repo = tmp_path / "repo"
    repo.mkdir()
    _seed_repo(repo, "v0.0.0")

    monkeypatch.setattr(_sys, "stdin", io.StringIO(json.dumps(_make_apply_payload())))
    with pytest.raises(SystemExit) as exc_info:
        do_apply(repo)
    msg = str(exc_info.value.code)
    assert "post-update" in msg
    assert "v0.0.0" in msg
    assert __version__ in msg


def test_apply_version_guard_aborts_if_skill_ahead(tmp_path: Path, monkeypatch):
    """Skill ahead of CLI → update message."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _seed_repo(repo, "v99.0.0")

    monkeypatch.setattr(_sys, "stdin", io.StringIO(json.dumps(_make_apply_payload())))
    with pytest.raises(SystemExit) as exc_info:
        do_apply(repo)
    msg = str(exc_info.value.code)
    assert "jadelens update" in msg
    assert "v99.0.0" in msg


def test_apply_version_guard_passes_when_versions_match(tmp_path: Path, monkeypatch):
    """No abort when skill version == installed CLI version."""
    from jadelens import __version__
    repo = tmp_path / "repo"
    repo.mkdir()
    _seed_repo(repo, __version__)

    # do_apply will fail past the version guard (no git remote for sync),
    # but the important thing is the SystemExit is NOT the version-guard one.
    monkeypatch.setattr(_sys, "stdin", io.StringIO(json.dumps(_make_apply_payload())))
    with pytest.raises(SystemExit) as exc_info:
        do_apply(repo)
    msg = str(exc_info.value.code)
    assert "post-update" not in msg


# ---------------------- run-migration-helper / promote_sidecars ----------------------


def _make_v1_repo_with_promotable(path: Path) -> None:
    """Set up a valid v1 data repo with a JSON file containing promotable strings."""
    from jadelens.operations import dumps_js_canonical

    _make_git_repo(path)
    _write_config(path, VALID_CONFIG)
    (path / ".jade").mkdir(parents=True, exist_ok=True)
    (path / ".jade" / "version").write_text("v1\n")

    items = {
        "title": "Short title",
        "description": "First paragraph.\n\nSecond paragraph.",
    }
    (path / "Items.json").write_text(dumps_js_canonical(items))
    index = [{"File": "[[Items.json]]", "Scope": "Items"}]
    (path / "Index.json").write_text(dumps_js_canonical(index))

    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(path), "commit", "-m", "initial"], check=True, capture_output=True
    )


def test_promote_sidecars_promotes_qualifying_strings(tmp_path: Path, capsys):
    """promote_sidecars replaces promotable strings with sidecar wikilinks."""
    from jadelens.migrations.v1_v2.helpers import promote_sidecars

    repo = tmp_path / "repo"
    repo.mkdir()
    _make_v1_repo_with_promotable(repo)

    promote_sidecars(repo, None)

    data = json.loads((repo / "Items.json").read_text())
    # Multi-paragraph description should be promoted to a wikilink
    assert data["description"].startswith("[[")
    assert data["description"].endswith("]]")
    # Single-word title is not promotable
    assert data["title"] == "Short title"

    # Sidecar file created with original content
    sidecar_path = repo / "Items.sidecars" / "description.md"
    assert sidecar_path.is_file()
    assert "First paragraph." in sidecar_path.read_text()

    out = capsys.readouterr().out
    assert "1 values promoted" in out
    assert "1 sidecars created" in out


def test_promote_sidecars_skips_already_wikilinks(tmp_path: Path, capsys):
    """promote_sidecars does not re-promote values that are already wikilinks."""
    from jadelens.migrations.v1_v2.helpers import promote_sidecars
    from jadelens.operations import dumps_js_canonical

    repo = tmp_path / "repo"
    repo.mkdir()
    _make_git_repo(repo)
    _write_config(repo, VALID_CONFIG)
    (repo / ".jade").mkdir(parents=True, exist_ok=True)
    (repo / ".jade" / "version").write_text("v1\n")

    # Create sidecar dir and file manually to represent an already-promoted value
    (repo / "Items.sidecars").mkdir()
    (repo / "Items.sidecars" / "notes.md").write_text("Para one.\n\nPara two.")
    data = {"notes": "[[Items.sidecars/notes.md]]", "title": "Short"}
    (repo / "Items.json").write_text(dumps_js_canonical(data))
    index = [{"File": "[[Items.json]]", "Scope": "Items"}]
    (repo / "Index.json").write_text(dumps_js_canonical(index))

    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "initial"], check=True, capture_output=True
    )

    promote_sidecars(repo, None)

    out = capsys.readouterr().out
    assert "0 values promoted" in out


def test_run_migration_helper_unknown_identifier_exits(tmp_path: Path, monkeypatch):
    """Unknown identifier exits with a clear error message."""
    from jadelens.cli import do_run_migration_helper

    repo = tmp_path / "repo"
    repo.mkdir()
    monkeypatch.setattr(_sys, "stdin", io.StringIO(""))

    with pytest.raises(SystemExit) as exc_info:
        do_run_migration_helper(repo, "v99/nonexistent")
    msg = str(exc_info.value.code)
    assert "Unknown migration helper" in msg
    assert "v99/nonexistent" in msg


def test_run_migration_helper_dispatches_to_promote_sidecars(tmp_path: Path, monkeypatch):
    """v1_v2/promote-sidecars dispatches to the promote_sidecars helper."""
    from jadelens.cli import do_run_migration_helper

    repo = tmp_path / "repo"
    repo.mkdir()
    monkeypatch.setattr(_sys, "stdin", io.StringIO(""))

    called: list[tuple] = []

    def _mock_promote(data_repo, stdin_data):
        called.append((data_repo, stdin_data))

    monkeypatch.setattr(
        "jadelens.migrations.v1_v2.helpers.promote_sidecars", _mock_promote
    )

    do_run_migration_helper(repo, "v1_v2/promote-sidecars")

    assert len(called) == 1
    assert called[0] == (repo, None)


# ---------------------- jadelens check ----------------------


def test_check_passes_on_valid_repo(tmp_path: Path, capsys):
    """do_check prints success when all invariants pass."""
    from jadelens.cli import do_check

    repo = tmp_path / "repo"
    repo.mkdir()
    _make_v1_repo_with_promotable(repo)

    do_check(repo)

    out = capsys.readouterr().out
    assert "All checks passed" in out


def test_check_fails_on_invalid_repo(tmp_path: Path):
    """do_check exits with 'Check failed' when an invariant is violated."""
    from jadelens.cli import do_check
    from jadelens.operations import dumps_js_canonical

    repo = tmp_path / "repo"
    repo.mkdir()
    _make_git_repo(repo)
    (repo / ".jade").mkdir(parents=True, exist_ok=True)
    # Malformed Index.json — not an array
    (repo / "Index.json").write_text(dumps_js_canonical({"bad": "data"}))
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "bad index"], check=True, capture_output=True
    )

    with pytest.raises(SystemExit) as exc_info:
        do_check(repo)
    assert "Check failed" in str(exc_info.value.code)


def test_check_passes_with_non_ascii_filename(tmp_path: Path):
    """Regression: git ls-files octal-quotes non-ASCII paths by default
    (e.g. ``"Job Search \\342\\200\\224 ….md"``). The enforcement pass must see
    the real Unicode path so a correctly indexed file with an em dash in its
    name passes instead of raising INDEX_MISSING_ENTRY."""
    from jadelens import workflow
    from jadelens.operations import dumps_js_canonical

    repo = tmp_path / "repo"
    repo.mkdir()
    _make_git_repo(repo)
    (repo / ".jade").mkdir(parents=True, exist_ok=True)
    (repo / ".jade" / "version").write_text("v2\n")

    # Em dash (U+2014) — the exact character from the reported repo.
    fname = "Job Search — German climate tech media.md"
    (repo / fname).write_text("# Notes\n\nSome content.\n")
    index = [{"File": f"[[{fname}]]", "Scope": "Job search notes"}]
    (repo / "Index.json").write_text(dumps_js_canonical(index))

    subprocess.run(
        ["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True
    )
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "non-ascii"],
        check=True, capture_output=True,
    )

    # Must not raise: previously failed with INDEX_MISSING_ENTRY because the
    # quoted path never matched the Unicode wikilink in Index.json.
    workflow.run_enforcement_pass(repo)


def test_apply_unsafe_skips_push(tmp_path: Path, monkeypatch):
    """do_apply with unsafe=True does not call sync.push."""
    from jadelens.apply import do_apply
    from jadelens import sync

    repo = tmp_path / "repo"
    repo.mkdir()
    _make_v1_repo_with_promotable(repo)

    push_called = []
    monkeypatch.setattr(sync, "pull", lambda _: None)
    monkeypatch.setattr(sync, "push", lambda _: push_called.append(True))

    payload = {"commit_message": "test", "operations": [
        {"op": "json_patch", "path": "Items.json",
         "patch": [{"op": "replace", "path": "/title", "value": "New title"}]}
    ]}
    monkeypatch.setattr(_sys, "stdin", io.StringIO(json.dumps(payload)))

    do_apply(repo, unsafe=True)

    assert push_called == [], "sync.push must not be called in unsafe mode"