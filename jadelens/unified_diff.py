"""Parsing and application of 0-context unified diffs.

This is a custom implementation because we want strict, predictable
semantics rather than the fuzzy / line-number-drift behaviour of GNU
``patch`` and most off-the-shelf libraries:

- All hunks within a diff reference the **original** file's line numbers.
  The bot reads the file once, plans multiple edits against that snapshot,
  and emits one diff with multiple hunks.
- Hunks must be in strictly increasing ``-L`` order and must not overlap.
- Each ``-`` line in a hunk must match the file's line at its claimed
  position exactly, byte-for-byte (modulo the trailing newline). Any
  mismatch aborts the entire diff with an informative error.
- Lines are assumed to be \\n-terminated. The applier preserves the
  original file's trailing-newline status; added lines get \\n appended.
"""

import re
from dataclasses import dataclass

HUNK_HEADER_RE = re.compile(
    r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@"
)


class DiffParseError(Exception):
    """The diff text could not be parsed as a 0-context unified diff."""


class DiffApplyError(Exception):
    """The diff parsed but couldn't be applied (verification mismatch, etc.)."""


@dataclass(slots=True, frozen=True)
class Hunk:
    old_start: int  # 1-indexed line in old file; for pure insert, the line AFTER which to insert
    old_count: int  # number of lines removed (0 for pure insert)
    removed_lines: tuple[str, ...]
    added_lines: tuple[str, ...]


def parse_unified_diff(diff_text: str) -> list[Hunk]:
    """Parse a 0-context unified diff into a list of Hunks.

    Tolerates the optional ``--- a/...`` / ``+++ b/...`` header lines (and
    any other lines before the first ``@@``). Raises ``DiffParseError`` on
    format issues.
    """
    lines = diff_text.split("\n")
    # If the diff ended with \n, split gives a trailing empty string. Drop it.
    if lines and lines[-1] == "":
        lines.pop()

    hunks: list[Hunk] = []
    i = 0
    # Skip any preamble (file headers, etc.) until the first hunk header.
    while i < len(lines) and not lines[i].startswith("@@"):
        i += 1

    while i < len(lines):
        header_match = HUNK_HEADER_RE.match(lines[i])
        if not header_match:
            raise DiffParseError(f"Malformed hunk header: {lines[i]!r}")
        old_start = int(header_match.group(1))
        old_count = (
            int(header_match.group(2)) if header_match.group(2) is not None else 1
        )
        new_count = (
            int(header_match.group(3)) if header_match.group(3) is not None else 1
        )
        i += 1

        removed: list[str] = []
        added: list[str] = []
        while i < len(lines) and not lines[i].startswith("@@"):
            line = lines[i]
            if line.startswith("-"):
                removed.append(line[1:])
            elif line.startswith("+"):
                added.append(line[1:])
            elif line.startswith(" "):
                raise DiffParseError(
                    f"Context lines are not supported (0-context format "
                    f"required): {line!r}"
                )
            else:
                raise DiffParseError(
                    f"Unexpected line in hunk body: {line!r}"
                )
            i += 1

        if len(removed) != old_count:
            raise DiffParseError(
                f"Hunk header declared {old_count} removed line(s) but "
                f"hunk body has {len(removed)}"
            )
        if len(added) != new_count:
            raise DiffParseError(
                f"Hunk header declared {new_count} added line(s) but "
                f"hunk body has {len(added)}"
            )

        hunks.append(
            Hunk(
                old_start=old_start,
                old_count=old_count,
                removed_lines=tuple(removed),
                added_lines=tuple(added),
            )
        )

    _verify_ordering_and_non_overlap(hunks)
    return hunks


def _verify_ordering_and_non_overlap(hunks: list[Hunk]) -> None:
    """Hunks must be strictly increasing in old_start AND not touch positions a
    previous hunk already addressed.

    The minimum allowed ``B.old_start`` depends on both A's type (addressing
    vs. pure insert) and B's type, because pure inserts occupy a point
    *between* lines:

    | A           | B           | min B.old_start              |
    |-------------|-------------|------------------------------|
    | addressing  | addressing  | A.old_start + A.old_count    |
    | addressing  | pure insert | A.old_start + A.old_count - 1|
    | pure insert | addressing  | A.old_start + 1              |
    | pure insert | pure insert | A.old_start + 1              |

    The addressing-then-pure-insert case is the subtle one: an insert at the
    boundary just after A's last addressed line is legitimate (e.g. replace
    line 5, then insert after line 5).
    """
    for i in range(len(hunks) - 1):
        a, b = hunks[i], hunks[i + 1]
        if a.old_count == 0:
            # A is a pure insert; B (any type) must start strictly after.
            min_b_start = a.old_start + 1
        elif b.old_count == 0:
            # A addressing, B pure insert: B at the boundary right after
            # A's last addressed line is OK.
            min_b_start = a.old_start + a.old_count - 1
        else:
            # Both addressing: B must start after A's range.
            min_b_start = a.old_start + a.old_count
        if b.old_start < min_b_start:
            raise DiffParseError(
                f"Hunks out of order or overlapping: previous hunk "
                f"@@ -{a.old_start},{a.old_count} ... @@ is followed by "
                f"hunk @@ -{b.old_start},{b.old_count} ... @@ "
                f"(B.old_start must be >= {min_b_start})"
            )


def apply_unified_diff(original: str, diff_text: str) -> str:
    """Apply a 0-context unified diff to ``original``, returning the new text.

    Raises ``DiffParseError`` if the diff is malformed, or ``DiffApplyError``
    if any hunk's removed lines don't match the file at the claimed position.
    """
    hunks = parse_unified_diff(diff_text)
    original_lines = original.splitlines(keepends=True)

    new_lines: list[str] = []
    cursor = 0  # 0-indexed position in original_lines

    for hunk in hunks:
        # Convert 1-indexed old_start to 0-indexed position in original_lines.
        if hunk.old_count > 0:
            insert_at = hunk.old_start - 1
        else:
            # Pure insert: hunk header's old_start is the line AFTER which
            # to insert. For old_start=0, insert at index 0 (start of file).
            insert_at = hunk.old_start

        # Copy untouched lines from cursor up to the hunk's position.
        new_lines.extend(original_lines[cursor:insert_at])

        # Verify removed lines match file content at the claimed position.
        for offset, expected in enumerate(hunk.removed_lines):
            idx = insert_at + offset
            if idx >= len(original_lines):
                raise DiffApplyError(
                    f"Hunk references line {idx + 1} but file only has "
                    f"{len(original_lines)} line(s)"
                )
            actual = original_lines[idx].rstrip("\n")
            if actual != expected:
                raise DiffApplyError(
                    f"Line {idx + 1} mismatch: file has {actual!r}, "
                    f"hunk expected {expected!r}"
                )

        # Emit added lines, each with a trailing \n.
        for added in hunk.added_lines:
            new_lines.append(added + "\n")

        # Advance cursor past the removed lines.
        cursor = insert_at + hunk.old_count

    # Copy any remaining lines unchanged.
    new_lines.extend(original_lines[cursor:])
    return "".join(new_lines)