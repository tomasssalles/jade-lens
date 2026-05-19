"""Tests for jadelens.config.config_from_mapping."""

from pathlib import Path

import pytest

from jadelens.config import (
    Config,
    MissingField,
    UnknownVersion,
    config_from_mapping,
)


def test_v0_1_0_happy_path():
    mapping = {
        "SKILL_NAME": "foo",
        "DATA_REPO_PATH": "/home/tom/data",
        "CODE_REPO_PATH": "/home/tom/code",  # ambient, should be ignored
    }
    config = config_from_mapping(mapping, "v0.1.0")
    assert config == Config(
        skill_name="foo",
        data_repo_path=Path("/home/tom/data"),
    )


def test_v0_1_0_without_code_repo_path_works():
    """CODE_REPO_PATH is ambient and not required for Config."""
    mapping = {
        "SKILL_NAME": "foo",
        "DATA_REPO_PATH": "/home/tom/data",
    }
    config = config_from_mapping(mapping, "v0.1.0")
    assert config.skill_name == "foo"
    assert config.data_repo_path == Path("/home/tom/data")


def test_v0_1_0_missing_skill_name_raises():
    mapping = {
        "DATA_REPO_PATH": "/home/tom/data",
    }
    with pytest.raises(MissingField) as exc_info:
        config_from_mapping(mapping, "v0.1.0")
    assert "SKILL_NAME" in str(exc_info.value)


def test_v0_1_0_missing_data_repo_path_raises():
    mapping = {
        "SKILL_NAME": "foo",
    }
    with pytest.raises(MissingField) as exc_info:
        config_from_mapping(mapping, "v0.1.0")
    assert "DATA_REPO_PATH" in str(exc_info.value)


def test_unknown_version_raises():
    mapping = {
        "SKILL_NAME": "foo",
        "DATA_REPO_PATH": "/home/tom/data",
    }
    with pytest.raises(UnknownVersion) as exc_info:
        config_from_mapping(mapping, "v99.99.99")
    assert "v99.99.99" in str(exc_info.value)


def test_relative_data_repo_path_raises_value_error():
    """Config.__post_init__ rejects non-absolute paths; this propagates."""
    mapping = {
        "SKILL_NAME": "foo",
        "DATA_REPO_PATH": "relative/path",
    }
    with pytest.raises(ValueError, match="must be absolute"):
        config_from_mapping(mapping, "v0.1.0")


def test_empty_skill_name_raises_value_error():
    mapping = {
        "SKILL_NAME": "",
        "DATA_REPO_PATH": "/home/tom/data",
    }
    with pytest.raises(ValueError, match="skill_name must not be empty"):
        config_from_mapping(mapping, "v0.1.0")