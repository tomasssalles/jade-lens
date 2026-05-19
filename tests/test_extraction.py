"""Tests for jadelens.skill.extract_template_vars."""

import pytest

from jadelens.skill import Disagreement, NoMatch, extract_template_vars


def test_extract_single_placeholder():
    template = "Hello {{NAME}}!"
    skill = "Hello world!"
    assert extract_template_vars(template, skill) == {"NAME": "world"}


def test_extract_multiple_distinct_placeholders():
    template = "Hello {{NAME}}, your path is {{PATH}}."
    skill = "Hello foo, your path is /home/tom/data."
    assert extract_template_vars(template, skill) == {
        "NAME": "foo",
        "PATH": "/home/tom/data",
    }


def test_extract_multi_occurrence_agreeing():
    template = "{{X}} and {{X}} again"
    skill = "foo and foo again"
    assert extract_template_vars(template, skill) == {"X": "foo"}


def test_extract_multi_occurrence_disagreeing_raises():
    template = "{{X}} and {{X}} again"
    skill = "foo and bar again"
    with pytest.raises(Disagreement) as exc_info:
        extract_template_vars(template, skill)
    assert exc_info.value.name == "X"
    assert exc_info.value.values == ["foo", "bar"]


def test_extract_no_match_when_surrounding_text_diverges():
    template = "Hello {{NAME}}!"
    skill = "Goodbye foo!"
    with pytest.raises(NoMatch):
        extract_template_vars(template, skill)


def test_extract_no_match_when_skill_is_empty():
    template = "Hello {{NAME}}!"
    skill = ""
    with pytest.raises(NoMatch):
        extract_template_vars(template, skill)


def test_extract_no_match_when_skill_has_trailing_content():
    template = "Hello {{NAME}}!"
    skill = "Hello foo! Extra appended content."
    with pytest.raises(NoMatch):
        extract_template_vars(template, skill)


def test_extract_no_placeholders():
    template = "Just some text."
    skill = "Just some text."
    assert extract_template_vars(template, skill) == {}


def test_extract_no_placeholders_with_divergent_skill_raises():
    template = "Just some text."
    skill = "Different text."
    with pytest.raises(NoMatch):
        extract_template_vars(template, skill)


def test_extract_path_value_with_special_chars():
    template = "Path: {{P}}"
    skill = "Path: /home/tom/dev/jade-lens (v1.0)"
    assert extract_template_vars(template, skill) == {
        "P": "/home/tom/dev/jade-lens (v1.0)",
    }


def test_extract_multiline_template():
    template = """---
name: {{NAME}}
---

# Hello

Data: {{PATH}}
"""
    skill = """---
name: foo
---

# Hello

Data: /home/tom/data
"""
    assert extract_template_vars(template, skill) == {
        "NAME": "foo",
        "PATH": "/home/tom/data",
    }


def test_extract_disagreement_three_occurrences():
    template = "{{X}}, {{X}}, {{X}}"
    skill = "a, a, b"
    with pytest.raises(Disagreement) as exc_info:
        extract_template_vars(template, skill)
    assert exc_info.value.name == "X"
    assert exc_info.value.values == ["a", "a", "b"]


def test_extract_regex_special_chars_in_template_literal_text():
    """Template prose containing regex specials (. + * ? etc.) is treated as literal."""
    template = "Version: {{V}} (a.b.c)?"
    skill = "Version: 1.0 (a.b.c)?"
    assert extract_template_vars(template, skill) == {"V": "1.0"}