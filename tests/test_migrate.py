"""Tests for jadelens.migrate (jadelens migrate sub-command)."""

import subprocess
from pathlib import Path

import pytest

from jadelens import __supported_data_format_version__


# ─── Fixtures / helpers ──────────────────────────────────────────────────────


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=True,
    )


def _make_migrate_repo(tmp_path: Path, version: str) -> Path:
    """Create a local git repo with a bare remote, at the given data version.

    The repo has a committed .jade/version and Index.json, and a tracking
    branch so `git push origin main` works.
    """
    remote = tmp_path / "remote.git"
    repo = tmp_path / "repo"

    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    for k, v in [("user.email", "t@e.st"), ("user.name", "T"),
                  ("commit.gpgsign", "false")]:
        _git(repo, "config", k, v)

    (repo / ".jade").mkdir()
    (repo / ".jade" / "version").write_text(f"{version}\n")
    (repo / "Index.json").write_text("[]")

    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "init")

    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
    _git(repo, "remote", "add", "origin", str(remote))
    _git(repo, "push", "-q", "-u", "origin", "main")

    return repo


def _head_sha(repo: Path) -> str:
    return _git(repo, "rev-parse", "HEAD").stdout.strip()


def _tag_sha(repo: Path, tag: str) -> str:
    return _git(repo, "rev-parse", tag).stdout.strip()


def _tag_exists(repo: Path, tag: str) -> bool:
    return bool(_git(repo, "tag", "-l", tag).stdout.strip())


# ─── Tests ───────────────────────────────────────────────────────────────────


class TestPhaseBDone:
    def test_prints_done_when_data_matches_supported(self, tmp_path, capsys):
        """Phase B prints DONE immediately when data version == supported version."""
        from jadelens.migrate import do_migrate

        supported_int = int(__supported_data_format_version__.lstrip("v"))
        repo = _make_migrate_repo(tmp_path, f"v{supported_int}")

        do_migrate(repo, None)

        assert capsys.readouterr().out.strip() == "DONE"

    def test_done_after_finalize_reaches_supported(self, tmp_path, monkeypatch, capsys):
        """After --finalize bumps .jade/version to supported, Phase B prints DONE."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")

        do_migrate(repo, "v1-v2")

        out = capsys.readouterr().out
        assert "DONE" in out
        assert (repo / ".jade" / "version").read_text().strip() == "v2"


class TestPhaseBFreshStart:
    def test_creates_start_tag_and_outputs_runbook(self, tmp_path, monkeypatch, capsys):
        """Fresh start: creates v1-v2-migration-start and prints the v1→v2 runbook."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")

        do_migrate(repo, None)

        out = capsys.readouterr().out
        assert "Here's the runbook for migration `v1-v2`:" in out
        assert _tag_exists(repo, "v1-v2-migration-start")

    def test_start_tag_pushed_to_remote(self, tmp_path, monkeypatch, capsys):
        """The start tag is pushed to remote, not just local."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")

        do_migrate(repo, None)

        # Fetch tags from remote and verify
        remote = tmp_path / "remote.git"
        result = subprocess.run(
            ["git", "-C", str(remote), "tag", "-l", "v1-v2-migration-start"],
            capture_output=True, text=True, check=True,
        )
        assert "v1-v2-migration-start" in result.stdout

    def test_runbook_contains_content(self, tmp_path, monkeypatch, capsys):
        """The runbook is not empty — it has actual content from RUNBOOK.md."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")

        do_migrate(repo, None)

        out = capsys.readouterr().out
        # RUNBOOK.md has step headings
        assert "Step 1" in out or "## Step" in out


class TestPhaseBCrashRecovery:
    def test_resets_head_and_warns_when_head_ahead_of_start_tag(
        self, tmp_path, monkeypatch, capsys
    ):
        """When HEAD is ahead of start tag, reset to tag and print rollback warning."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")

        # Create start tag at current HEAD
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")
        start_sha = _head_sha(repo)

        # Make a "crash commit" (simulates incomplete migration work)
        (repo / "crash.md").write_text("incomplete\n")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "-m", "crash work")
        assert _head_sha(repo) != start_sha

        do_migrate(repo, None)

        out = capsys.readouterr().out
        assert "Rolled back" in out
        assert "Here's the runbook for migration `v1-v2`:" in out
        # HEAD should be back at start tag
        assert _head_sha(repo) == start_sha
        assert not (repo / "crash.md").exists()

    def test_crash_recovery_does_not_leave_extra_commits(
        self, tmp_path, monkeypatch, capsys
    ):
        """After crash recovery, the log has no extra commits beyond the start tag."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")
        expected_sha = _head_sha(repo)

        # Simulate two crash commits
        for i in range(2):
            (repo / f"crash{i}.md").write_text("work\n")
            _git(repo, "add", "-A")
            _git(repo, "commit", "-q", "-m", f"crash {i}")

        do_migrate(repo, None)
        capsys.readouterr()

        assert _head_sha(repo) == expected_sha


class TestPhaseBCleanResume:
    def test_outputs_runbook_without_rollback_when_head_at_start_tag(
        self, tmp_path, monkeypatch, capsys
    ):
        """When HEAD == start tag, resume cleanly without any rollback message."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")

        do_migrate(repo, None)

        out = capsys.readouterr().out
        assert "Rolled back" not in out
        assert "Here's the runbook for migration `v1-v2`:" in out


class TestPhaseA:
    def test_bumps_version_and_creates_end_tag(self, tmp_path, monkeypatch, capsys):
        """Phase A writes v2 to .jade/version, commits it, creates end tag."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")

        do_migrate(repo, "v1-v2")
        capsys.readouterr()

        assert (repo / ".jade" / "version").read_text().strip() == "v2"
        assert _tag_exists(repo, "v1-v2-migration-end")

    def test_idempotent_if_version_already_bumped(self, tmp_path, monkeypatch, capsys):
        """Phase A is a no-op for the version bump if .jade/version is already v(N+1)."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")

        # Pre-bump version manually (simulate crash after bump, before end tag)
        (repo / ".jade" / "version").write_text("v2\n")
        _git(repo, "add", ".jade/version")
        _git(repo, "commit", "-q", "-m", "migration: bump data format to v2")

        sha_before = _head_sha(repo)
        do_migrate(repo, "v1-v2")
        capsys.readouterr()

        # No extra commit should have been made for the version bump
        assert _head_sha(repo) == sha_before
        assert _tag_exists(repo, "v1-v2-migration-end")

    def test_idempotent_if_end_tag_already_exists(self, tmp_path, monkeypatch, capsys):
        """Phase A skips end-tag creation if it already exists."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")

        # Pre-create end tag
        _git(repo, "tag", "v1-v2-migration-end")

        # Should not raise even though the tag already exists
        do_migrate(repo, "v1-v2")
        capsys.readouterr()

        assert _tag_exists(repo, "v1-v2-migration-end")

    def test_exits_if_start_tag_missing(self, tmp_path, monkeypatch):
        """Phase A exits with an error if the start tag was never created."""
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v2")
        repo = _make_migrate_repo(tmp_path, "v1")

        with pytest.raises(SystemExit) as exc_info:
            do_migrate(repo, "v1-v2")
        assert "start tag" in str(exc_info.value.code).lower()

    def test_rejects_bad_finalize_format(self, tmp_path):
        """Invalid --finalize values exit with a clear error."""
        from jadelens.migrate import do_migrate

        repo = tmp_path / "repo"
        repo.mkdir()

        for bad in ["v1v2", "v1-v3", "v1-v2-v3", "abc-def"]:
            with pytest.raises(SystemExit):
                do_migrate(repo, bad)


class TestMultiStepSequence:
    def test_finalize_then_next_runbook(self, tmp_path, monkeypatch, capsys):
        """After --finalize bumps to v2 (supported=v3), Phase B outputs the v2-v3 runbook.

        v2_v3/RUNBOOK.md doesn't exist in the package, so we patch the ``files``
        binding in jadelens.migrate to return a stub for that path only.
        """
        from jadelens import migrate as migrate_module
        from jadelens.migrate import do_migrate

        monkeypatch.setattr("jadelens.migrate.__supported_data_format_version__", "v3")
        repo = _make_migrate_repo(tmp_path, "v1")
        _git(repo, "tag", "v1-v2-migration-start")
        _git(repo, "push", "origin", "--tags")

        real_files = migrate_module.files  # original importlib.resources.files

        class _FakeLeaf:
            def read_text(self):
                return "Stub v2→v3 runbook.\n"

        class _FakeWrapper:
            def __init__(self, pkg):
                self._real = real_files(pkg)

            def joinpath(self, *parts):
                if "v2_v3" in parts:
                    return _FakeLeaf()
                return self._real.joinpath(*parts)

        monkeypatch.setattr(migrate_module, "files", _FakeWrapper)

        do_migrate(repo, "v1-v2")

        out = capsys.readouterr().out
        assert "Here's the runbook for migration `v2-v3`:" in out
        assert (repo / ".jade" / "version").read_text().strip() == "v2"
        assert _tag_exists(repo, "v1-v2-migration-end")


class TestMigrateSkillRendering:
    def test_do_render_skill_also_renders_migrate_skill(self, tmp_path):
        """do_render_skill writes both main and migrate SKILL.md files."""
        from jadelens.cli import do_render_skill, _write_common_files
        import json

        config = {
            "user": {"full_name": "Test User", "short_name": "Test"},
            "assistant": {"name": "jade"},
        }
        jade_dir = tmp_path / ".jade"
        jade_dir.mkdir()
        (jade_dir / "config.json").write_text(json.dumps(config))

        do_render_skill(tmp_path)

        main_skill = tmp_path / ".claude" / "skills" / "jade" / "SKILL.md"
        migrate_skill = tmp_path / ".claude" / "skills" / "jade-migrate" / "SKILL.md"

        assert main_skill.is_file()
        assert migrate_skill.is_file()
        assert "jade-migrate" in migrate_skill.read_text()
        assert str(tmp_path) in migrate_skill.read_text()

    def test_migrate_skill_no_op_if_already_exists(self, tmp_path):
        """do_render_skill skips the migrate skill if it already exists (no force)."""
        from jadelens.cli import do_render_skill
        import json

        config = {
            "user": {"full_name": "Test User", "short_name": "Test"},
            "assistant": {"name": "jade"},
        }
        jade_dir = tmp_path / ".jade"
        jade_dir.mkdir()
        (jade_dir / "config.json").write_text(json.dumps(config))

        # First render
        do_render_skill(tmp_path)

        migrate_skill = tmp_path / ".claude" / "skills" / "jade-migrate" / "SKILL.md"
        migrate_skill.write_text("custom content")

        # Second render (no force) — should not overwrite
        do_render_skill(tmp_path)

        assert migrate_skill.read_text() == "custom content"

    def test_migrate_skill_overwritten_with_force(self, tmp_path, capsys):
        """do_render_skill overwrites the migrate skill when force=True."""
        from jadelens.cli import do_render_skill
        import json

        config = {
            "user": {"full_name": "Test User", "short_name": "Test"},
            "assistant": {"name": "jade"},
        }
        jade_dir = tmp_path / ".jade"
        jade_dir.mkdir()
        (jade_dir / "config.json").write_text(json.dumps(config))

        do_render_skill(tmp_path)
        migrate_skill = tmp_path / ".claude" / "skills" / "jade-migrate" / "SKILL.md"
        migrate_skill.write_text("custom content")

        do_render_skill(tmp_path, force=True)
        capsys.readouterr()

        assert migrate_skill.read_text() != "custom content"
        assert "jade-migrate" in migrate_skill.read_text()
