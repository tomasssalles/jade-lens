"""Tests for jadelens.sidecar — content-block counter and promotion trigger."""

import pytest

from jadelens.sidecar import count_content_blocks, is_promotable


# ---------------------------------------------------------------------------
# Cases: returns exactly 1 block (not promotable)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text", [
    "Hello, world.\n",
    "Hello, world.",
    # Multi-line single paragraph (word-wrap, still 1 paragraph block)
    "Line one continues\nright here without a blank line.\n",
    # Single heading
    "# Title\n",
    "## Sub-heading\n",
    # Single fenced code block
    "```python\nprint('hi')\n```\n",
    # Single blockquote
    "> A quote.\n",
    # Single bullet point
    "- One item\n",
    "* One item\n",
    # Single ordered list item
    "1. First item\n",
    # Empty string — 0 blocks, not promotable
    "",
    "   \n",
])
def test_count_is_one_or_zero(text):
    assert count_content_blocks(text) <= 1
    assert not is_promotable(text)


# ---------------------------------------------------------------------------
# Cases: returns > 1 block (promotable)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected_count", [
    # Two paragraphs
    ("Para one.\n\nPara two.\n", 2),
    # Heading + paragraph
    ("# Title\n\nBody text.\n", 2),
    # Two bullet points
    ("- Alpha\n- Beta\n", 2),
    # Three bullet points
    ("- A\n- B\n- C\n", 3),
    # Paragraph + fenced code block
    ("Description.\n\n```\ncode\n```\n", 2),
    # Paragraph + blockquote
    ("Before.\n\n> A quote.\n", 2),
    # Two blockquotes
    ("> First.\n\n> Second.\n", 2),
    # Ordered list with 2 items
    ("1. First\n2. Second\n", 2),
    # Heading + paragraph + code block
    ("# H\n\nText.\n\n```\ncode\n```\n", 3),
])
def test_count_is_multiple(text, expected_count):
    assert count_content_blocks(text) == expected_count
    assert is_promotable(text)


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_wikilink_string_is_still_parsed_as_text():
    # A wikilink value is just text from markdown-it's perspective (1 paragraph)
    assert count_content_blocks("[[notes.md]]") == 1
    assert not is_promotable("[[notes.md]]")


# ---------------------------------------------------------------------------
# 5b: JSON Pointer ↔ sidecar filepath mapping
# ---------------------------------------------------------------------------

from jadelens.sidecar import (  # noqa: E402
    pointer_to_sidecar_path,
    json_path_from_sidecar,
    sidecar_path_to_pointer,
)


class TestPointerToSidecarPath:
    def test_simple_key(self):
        assert pointer_to_sidecar_path("Garden.json", "/notes") == "Garden.sidecars/notes.md"

    def test_nested_object_path(self):
        assert (
            pointer_to_sidecar_path("Garden.json", "/phases/research/summary")
            == "Garden.sidecars/phases/research/summary.md"
        )

    def test_array_index(self):
        assert (
            pointer_to_sidecar_path("Garden.json", "/comparisons/0/description")
            == "Garden.sidecars/comparisons/0/description.md"
        )

    def test_subdirectory_json(self):
        assert (
            pointer_to_sidecar_path("a/b/Work.json", "/tasks/2/summary")
            == "a/b/Work.sidecars/tasks/2/summary.md"
        )

    def test_rfc6901_tilde_escape(self):
        # Key with ~ is escaped as ~0 in pointer, unescaped in filename
        assert (
            pointer_to_sidecar_path("F.json", "/key~0name")
            == "F.sidecars/key~name.md"
        )

    def test_invalid_pointer_no_slash(self):
        import pytest
        with pytest.raises(ValueError):
            pointer_to_sidecar_path("F.json", "notes")


class TestJsonPathFromSidecar:
    def test_root_level(self):
        assert json_path_from_sidecar("Garden.sidecars/notes.md") == "Garden.json"

    def test_nested_sidecar(self):
        assert json_path_from_sidecar("Garden.sidecars/comparisons/0/description.md") == "Garden.json"

    def test_subdirectory_json(self):
        assert json_path_from_sidecar("a/b/Work.sidecars/tasks/2/summary.md") == "a/b/Work.json"

    def test_no_sidecars_component_raises(self):
        import pytest
        with pytest.raises(ValueError):
            json_path_from_sidecar("Garden/notes.md")


class TestSidecarPathToPointer:
    def test_simple_key(self):
        data = {"notes": "some text"}
        assert sidecar_path_to_pointer("Garden.sidecars/notes.md", data) == "/notes"

    def test_array_index(self):
        data = {"comparisons": [{"description": "text"}]}
        assert (
            sidecar_path_to_pointer("Garden.sidecars/comparisons/0/description.md", data)
            == "/comparisons/0/description"
        )

    def test_object_key_zero(self):
        # Object key "0" should be treated as string key, not array index
        data = {"0": "value"}
        assert sidecar_path_to_pointer("F.sidecars/0.md", data) == "/0"

    def test_array_index_zero_vs_string(self):
        # Array element at index 0 should produce pointer /0
        data = [{"name": "first"}]
        # Pointer to the array root element isn't typical, but /0/name would be
        data2 = {"items": [{"name": "x"}]}
        assert sidecar_path_to_pointer("F.sidecars/items/0/name.md", data2) == "/items/0/name"

    def test_rfc6901_tilde_in_key(self):
        # Key with ~ should be escaped in pointer, unescaped in path
        data = {"key~name": "value"}
        assert sidecar_path_to_pointer("F.sidecars/key~name.md", data) == "/key~0name"

    def test_missing_key_raises(self):
        import pytest
        data = {"other": "value"}
        with pytest.raises(ValueError):
            sidecar_path_to_pointer("Garden.sidecars/notes.md", data)
