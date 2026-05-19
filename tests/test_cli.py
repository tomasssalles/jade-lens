"""Tests for jadelens.cli helpers (non-interactive parts)."""

from pathlib import Path

from jadelens.cli import scan_for_installs


def test_scan_for_installs_missing_dir_returns_empty(tmp_path: Path):
    assert scan_for_installs(tmp_path / "does-not-exist") == []


def test_scan_for_installs_empty_dir_returns_empty(tmp_path: Path):
    assert scan_for_installs(tmp_path) == []


def test_scan_for_installs_finds_marker_files(tmp_path: Path):
    # A jade-lens skill.
    (tmp_path / "jade").mkdir()
    jade_skill = tmp_path / "jade" / "SKILL.md"
    jade_skill.write_text("<!-- jade-lens-skill template-version=v0.1.0 -->\n")

    # A non-jade-lens skill (no marker).
    (tmp_path / "other").mkdir()
    (tmp_path / "other" / "SKILL.md").write_text("# Some other skill\n")

    # A directory without a SKILL.md.
    (tmp_path / "stray").mkdir()
    (tmp_path / "stray" / "notes.md").write_text("nothing here")

    found = scan_for_installs(tmp_path)
    assert found == [jade_skill]


def test_scan_for_installs_finds_multiple(tmp_path: Path):
    (tmp_path / "personal").mkdir()
    p = tmp_path / "personal" / "SKILL.md"
    p.write_text("<!-- jade-lens-skill template-version=v0.1.0 -->\n")

    (tmp_path / "family").mkdir()
    f = tmp_path / "family" / "SKILL.md"
    f.write_text("<!-- jade-lens-skill template-version=v0.1.0 -->\n")

    (tmp_path / "untracked").mkdir()
    (tmp_path / "untracked" / "SKILL.md").write_text("not a jade skill")

    found = set(scan_for_installs(tmp_path))
    assert found == {p, f}