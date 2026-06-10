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
