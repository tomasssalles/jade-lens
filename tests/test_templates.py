"""Smoke tests for the bundled skill template."""

from pathlib import Path

from importlib.resources import files

from jadelens import __version__
from jadelens.config import Config
from jadelens.skill import PLACEHOLDER_RE, render_skill


_FIXTURE_CONFIG = Config(
    assistant_name="testskill",
    data_repo_path=Path("/home/test/data"),
    user_full_name="Test User",
    user_short_name="Test",
)


def test_template_file_exists():
    template = files("jadelens").joinpath("templates", "skill.md")
    assert template.is_file(), "templates/skill.md not found"


def test_render_leaves_no_unreplaced_placeholders():
    template_text = files("jadelens").joinpath("templates", "skill.md").read_text()
    rendered = render_skill(_FIXTURE_CONFIG, template_text)
    leftovers = PLACEHOLDER_RE.findall(rendered)
    assert not leftovers, f"Unreplaced placeholders after render: {leftovers}"


def test_render_substitutes_expected_values():
    template_text = files("jadelens").joinpath("templates", "skill.md").read_text()
    rendered = render_skill(_FIXTURE_CONFIG, template_text)
    assert "testskill" in rendered
    assert "/home/test/data" in rendered
    assert "Test User" in rendered
    assert __version__ in rendered
