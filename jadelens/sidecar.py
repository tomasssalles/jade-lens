"""Sidecar promotion: trigger logic and path mapping."""

from markdown_it import MarkdownIt

_md = MarkdownIt()

# Token types that each count as one content block when they appear at document
# level (token.level == 0). List items are counted at any nesting depth.
_BLOCK_OPEN_TYPES_AT_ROOT = frozenset(
    {"paragraph_open", "heading_open", "blockquote_open"}
)


def count_content_blocks(text: str) -> int:
    """Count top-level content blocks in CommonMark text.

    Each paragraph, heading, fenced code block, blockquote, or individual list
    item (at any nesting depth) counts as one block. Returns the total.
    """
    count = 0
    for tok in _md.parse(text):
        if tok.type in _BLOCK_OPEN_TYPES_AT_ROOT and tok.level == 0:
            count += 1
        elif tok.type == "fence" and tok.level == 0:
            count += 1
        elif tok.type == "list_item_open":
            count += 1
    return count


def is_promotable(text: str) -> bool:
    """Return True if *text* should be promoted to a sidecar (> 1 block)."""
    return count_content_blocks(text) > 1
