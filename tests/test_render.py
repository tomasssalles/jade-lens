"""Tests for jadelens.skill.render_skill."""

from pathlib import Path

import pytest

from jadelens.config import Config, UnknownVersion
from jadelens.skill import render_skill


def _fixture_config() -> Config:
    return Config(
        skill_name="foo",
        data_repo_path=Path("/home/tom/data"),
        user_full_name="Test User",
        user_short_name="Test",
    )


def test_render_v0_1_0_simple_template():
    template = (
        "Name: {{SKILL_NAME}}, Data: {{DATA_REPO_PATH}}, Code: {{CODE_REPO_PATH}}"
    )
    result = render_skill(
        _fixture_config(), Path("/home/tom/code"), "v0.1.0", template
    )
    assert result == "Name: foo, Data: /home/tom/data, Code: /home/tom/code"


def test_render_v0_1_0_multi_occurrence_same_value():
    template = "{{SKILL_NAME}} and {{SKILL_NAME}} again"
    result = render_skill(_fixture_config(), Path("/c"), "v0.1.0", template)
    assert result == "foo and foo again"


def test_render_no_placeholders_unchanged():
    template = "Just plain text, nothing to substitute."
    result = render_skill(_fixture_config(), Path("/c"), "v0.1.0", template)
    assert result == template


def test_render_unknown_version_raises():
    template = "anything"
    with pytest.raises(UnknownVersion) as exc_info:
        render_skill(_fixture_config(), Path("/c"), "v99.99.99", template)
    assert "v99.99.99" in str(exc_info.value)


def test_render_unknown_placeholder_raises_key_error():
    """Template references a placeholder this version doesn't know."""
    template = "Hello {{NEW_FUTURE_FIELD}}!"
    with pytest.raises(KeyError) as exc_info:
        render_skill(_fixture_config(), Path("/c"), "v0.1.0", template)
    assert "NEW_FUTURE_FIELD" in str(exc_info.value)


def test_render_value_containing_regex_specials_is_safe():
    """Path values with regex specials must be emitted as literal text."""
    config = Config(
        skill_name="foo",
        data_repo_path=Path("/home/tom/data.v1+backup"),
        user_full_name="Test User",
        user_short_name="Test",
    )
    template = "Data: {{DATA_REPO_PATH}}"
    result = render_skill(config, Path("/c"), "v0.1.0", template)
    assert result == "Data: /home/tom/data.v1+backup"


def test_render_v0_1_0_user_name_placeholders():
    """USER_FULL_NAME and USER_SHORT_NAME substitute into the rendered text."""
    template = "{{USER_FULL_NAME}} aka {{USER_SHORT_NAME}}"
    config = Config(
        skill_name="foo",
        data_repo_path=Path("/d"),
        user_full_name="Tomás Silveira Salles",
        user_short_name="Tomás",
    )
    result = render_skill(config, Path("/c"), "v0.1.0", template)
    assert result == "Tomás Silveira Salles aka Tomás"