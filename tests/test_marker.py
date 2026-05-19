"""Tests for jadelens.skill.parse_marker."""

from jadelens.skill import parse_marker


def test_parse_marker_present():
    text = "<!-- jade-lens-skill template-version=v0.1.0 -->\n# Skill"
    assert parse_marker(text) == "v0.1.0"


def test_parse_marker_absent():
    text = "# A regular skill\n\nNo marker here."
    assert parse_marker(text) is None


def test_parse_marker_with_extra_whitespace():
    text = "<!--   jade-lens-skill   template-version=v0.2.3   -->"
    assert parse_marker(text) == "v0.2.3"


def test_parse_marker_inside_larger_document():
    text = """---
name: my-assistant
description: ...
---

<!-- jade-lens-skill template-version=v1.2.0 -->

# Body content here.
"""
    assert parse_marker(text) == "v1.2.0"


def test_parse_marker_malformed_no_version_field():
    text = "<!-- jade-lens-skill -->"
    assert parse_marker(text) is None


def test_parse_marker_malformed_empty_version():
    text = "<!-- jade-lens-skill template-version= -->"
    assert parse_marker(text) is None


def test_parse_marker_pre_release_version():
    """Semver-style pre-release identifiers (with hyphens, dots) parse as-is."""
    text = "<!-- jade-lens-skill template-version=v0.1.0-rc.1 -->"
    assert parse_marker(text) == "v0.1.0-rc.1"


def test_parse_marker_returns_none_when_multiple():
    """If multiple markers appear (degenerate case), return none."""
    text = (
        "<!-- jade-lens-skill template-version=v0.1.0 -->\n"
        "<!-- jade-lens-skill template-version=v0.9.0 -->"
    )
    assert parse_marker(text) is None
