"""Tests for jadelens.config.config_from_mapping."""

from pathlib import Path

import pytest

from jadelens.config import (
    Config,
    MissingField,
    UnknownVersion,
    config_from_mapping,
)


def _v0_1_0_mapping(**overrides) -> dict[str, str]:
    base = {
        "SKILL_NAME": "foo",
        "DATA_REPO_PATH": "/home/tom/data",
        "USER_FULL_NAME": "Test User",
        "USER_SHORT_NAME": "Test",
    }
    base.update(overrides)
    return base


def test_v0_1_0_happy_path():
    mapping = _v0_1_0_mapping(CODE_REPO_PATH="/home/tom/code")  # ambient, ignored
    config = config_from_mapping(mapping, "v0.1.0")
    assert config == Config(
        skill_name="foo",
        data_repo_path=Path("/home/tom/data"),
        user_full_name="Test User",
        user_short_name="Test",
    )


def test_v0_1_0_without_code_repo_path_works():
    """CODE_REPO_PATH is ambient and not required for Config."""
    config = config_from_mapping(_v0_1_0_mapping(), "v0.1.0")
    assert config.skill_name == "foo"
    assert config.data_repo_path == Path("/home/tom/data")
    assert config.user_full_name == "Test User"
    assert config.user_short_name == "Test"


def test_v0_1_0_missing_skill_name_raises():
    mapping = _v0_1_0_mapping()
    del mapping["SKILL_NAME"]
    with pytest.raises(MissingField) as exc_info:
        config_from_mapping(mapping, "v0.1.0")
    assert "SKILL_NAME" in str(exc_info.value)


def test_v0_1_0_missing_data_repo_path_raises():
    mapping = _v0_1_0_mapping()
    del mapping["DATA_REPO_PATH"]
    with pytest.raises(MissingField) as exc_info:
        config_from_mapping(mapping, "v0.1.0")
    assert "DATA_REPO_PATH" in str(exc_info.value)


def test_v0_1_0_missing_user_full_name_raises():
    mapping = _v0_1_0_mapping()
    del mapping["USER_FULL_NAME"]
    with pytest.raises(MissingField) as exc_info:
        config_from_mapping(mapping, "v0.1.0")
    assert "USER_FULL_NAME" in str(exc_info.value)


def test_v0_1_0_missing_user_short_name_raises():
    mapping = _v0_1_0_mapping()
    del mapping["USER_SHORT_NAME"]
    with pytest.raises(MissingField) as exc_info:
        config_from_mapping(mapping, "v0.1.0")
    assert "USER_SHORT_NAME" in str(exc_info.value)


def test_unknown_version_raises():
    with pytest.raises(UnknownVersion) as exc_info:
        config_from_mapping(_v0_1_0_mapping(), "v99.99.99")
    assert "v99.99.99" in str(exc_info.value)


def test_relative_data_repo_path_raises_value_error():
    """Config.__post_init__ rejects non-absolute paths; this propagates."""
    mapping = _v0_1_0_mapping(DATA_REPO_PATH="relative/path")
    with pytest.raises(ValueError, match="must be absolute"):
        config_from_mapping(mapping, "v0.1.0")


def test_empty_skill_name_raises_value_error():
    mapping = _v0_1_0_mapping(SKILL_NAME="")
    with pytest.raises(ValueError, match="skill_name must not be empty"):
        config_from_mapping(mapping, "v0.1.0")


def test_empty_user_full_name_raises_value_error():
    mapping = _v0_1_0_mapping(USER_FULL_NAME="")
    with pytest.raises(ValueError, match="user_full_name must not be empty"):
        config_from_mapping(mapping, "v0.1.0")


def test_empty_user_short_name_raises_value_error():
    mapping = _v0_1_0_mapping(USER_SHORT_NAME="")
    with pytest.raises(ValueError, match="user_short_name must not be empty"):
        config_from_mapping(mapping, "v0.1.0")