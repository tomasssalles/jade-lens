"""Invariant tests for the shipped templates under jadelens/templates/skill/."""

from importlib.resources import files
from pathlib import Path

from jadelens.config import Config, config_from_mapping
from jadelens.skill import extract_template_vars, parse_marker, render_skill


def _all_templates() -> list:
    """Return the bundled template resources, as ``Traversable`` objects."""
    skill_dir = files("jadelens").joinpath("templates", "skill")
    return [
        f for f in skill_dir.iterdir()
        if f.name.startswith("v") and f.name.endswith(".md")
    ]


def test_at_least_one_template():
    assert _all_templates(), "No templates found in jadelens.templates.skill"


def test_template_marker_version_matches_filename():
    """Each v<X>.md declares template-version=v<X> in its marker."""
    for tpl in _all_templates():
        filename_version = tpl.name[: -len(".md")]  # e.g. "v0.1.0"
        marker_version = parse_marker(tpl.read_text())
        assert marker_version == filename_version, (
            f"Template {tpl.name}: marker version {marker_version!r} "
            f"does not match filename-derived version {filename_version!r}"
        )


def test_template_render_extract_round_trip():
    """For each shipped template, render with a fixture config, then extract
    and verify the recovered values match.

    This is the load-bearing safety net: it catches placeholder-anchor
    ambiguity at template-author time (here, in CI) rather than at user-
    update time."""
    fixture_config = Config(
        assistant_name="testskill",
        data_repo_path=Path("/home/test/data"),
        user_full_name="Test User",
        user_short_name="Test",
    )

    for tpl in _all_templates():
        template_text = tpl.read_text()
        version = parse_marker(template_text)
        assert version is not None, f"Template {tpl.name} has no marker"

        rendered = render_skill(fixture_config, version, template_text)
        mapping = extract_template_vars(template_text, rendered)

        recovered_config = config_from_mapping(mapping, version)
        assert recovered_config == fixture_config, (
            f"Template {tpl.name}: Config did not round-trip "
            f"(got {recovered_config}, expected {fixture_config})"
        )
