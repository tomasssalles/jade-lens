"""Invariant tests for the shipped templates under templates/skill/."""

from pathlib import Path

from jadelens.config import Config, config_from_mapping
from jadelens.skill import extract_template_vars, parse_marker, render_skill

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "skill"


def _all_template_paths() -> list[Path]:
    return list(TEMPLATES_DIR.glob("v*.md"))


def test_templates_dir_exists():
    assert TEMPLATES_DIR.is_dir(), f"Templates directory missing: {TEMPLATES_DIR}"


def test_at_least_one_template():
    assert _all_template_paths(), "No templates found in templates/skill/"


def test_template_marker_version_matches_filename():
    """Each templates/skill/v<X>.md declares template-version=v<X> in its marker."""
    for path in _all_template_paths():
        filename_version = path.stem  # e.g. "v0.1.0"
        marker_version = parse_marker(path.read_text())
        assert marker_version == filename_version, (
            f"Template {path.name}: marker version {marker_version!r} "
            f"does not match filename-derived version {filename_version!r}"
        )


def test_template_render_extract_round_trip():
    """For each shipped template, render with a fixture config, then extract
    and verify the recovered values match.

    This is the load-bearing safety net: it catches placeholder-anchor
    ambiguity at template-author time (here, in CI) rather than at user-
    update time."""
    fixture_config = Config(
        skill_name="testskill",
        data_repo_path=Path("/home/test/data"),
    )
    fixture_code_repo = Path("/home/test/code")

    for path in _all_template_paths():
        template_text = path.read_text()
        version = parse_marker(template_text)
        assert version is not None, f"Template {path.name} has no marker"

        rendered = render_skill(
            fixture_config, fixture_code_repo, version, template_text
        )
        mapping = extract_template_vars(template_text, rendered)

        recovered_config = config_from_mapping(mapping, version)
        assert recovered_config == fixture_config, (
            f"Template {path.name}: Config did not round-trip "
            f"(got {recovered_config}, expected {fixture_config})"
        )
        assert mapping.get("CODE_REPO_PATH") == str(fixture_code_repo), (
            f"Template {path.name}: CODE_REPO_PATH did not round-trip "
            f"(got {mapping.get('CODE_REPO_PATH')!r}, expected "
            f"{str(fixture_code_repo)!r})"
        )
