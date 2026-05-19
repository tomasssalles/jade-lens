"""Operations on installed skill files: marker parsing, extraction, rendering."""

import re
from collections import defaultdict
from pathlib import Path

from jadelens.config import Config, UnknownVersion

MARKER_RE = re.compile(
    r"<!--\s*jade-lens-skill\s+template-version=(\S+?)\s*-->"
)

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z_][A-Z_0-9]*)\}\}")


class ExtractionError(Exception):
    """Base for extraction failures from skill files."""


class NoMatch(ExtractionError):
    """The template structure does not match the skill text.

    Indicates either a heavy manual edit of the skill or that the template
    provided does not correspond to the skill (e.g. wrong template version).
    """


class Disagreement(ExtractionError):
    """A placeholder appears multiple times in the template but the skill
    has differing values at those positions.

    Indicates that the user manually edited some — but not all — occurrences
    of a multi-occurrence placeholder.
    """

    def __init__(self, name: str, values: list[str]) -> None:
        self.name = name
        self.values = values
        super().__init__(
            f"Placeholder {{{{{name}}}}} appears {len(values)} times in the "
            f"template, but the skill has differing values at those positions: "
            f"{values!r}. This indicates a partial manual edit."
        )


def parse_marker(skill_text: str) -> str | None:
    """Return the template version from the jade-lens-skill marker comment.

    The marker has the form ``<!-- jade-lens-skill template-version=<version> -->``
    and is typically placed near the top of the skill file.

    Returns ``None`` if:
    - no marker is present, or
    - the marker is malformed (missing or empty version), or
    - multiple markers are present (an ambiguous, presumed-corrupt state).
    """
    matches = MARKER_RE.findall(skill_text)
    if len(matches) != 1:
        return None
    return matches[0]


def extract_template_vars(template_text: str, skill_text: str) -> dict[str, str]:
    """Extract concrete values for each ``{{PLACEHOLDER}}`` in ``template_text``
    by matching ``skill_text`` against the template's structure.

    Returns a mapping ``{placeholder_name: extracted_value}``.

    Raises:
        NoMatch: the template structure does not fit the skill text.
        Disagreement: a placeholder that appears multiple times in the template
            has differing values at its positions in the skill (indicating a
            partial manual edit).
    """
    pattern_parts: list[str] = []
    occurrence_names: list[tuple[str, str]] = []  # (base_name, unique_group_name)
    last_end = 0
    for i, ph_match in enumerate(PLACEHOLDER_RE.finditer(template_text)):
        base_name = ph_match.group(1)
        pattern_parts.append(re.escape(template_text[last_end : ph_match.start()]))
        unique = f"{base_name}__{i}"
        pattern_parts.append(f"(?P<{unique}>.+?)")
        occurrence_names.append((base_name, unique))
        last_end = ph_match.end()
    pattern_parts.append(re.escape(template_text[last_end:]))
    pattern = "".join(pattern_parts)

    full_regex = re.compile(pattern)
    match = full_regex.fullmatch(skill_text)
    if match is None:
        raise NoMatch(
            "Skill text does not match the structure of the template. The "
            "skill may be from a different template version, or it has been "
            "edited in a way the template can no longer match against."
        )

    by_base: defaultdict[str, list[str]] = defaultdict(list)
    for base, unique in occurrence_names:
        by_base[base].append(match.group(unique))

    result: dict[str, str] = {}
    for base, values in by_base.items():
        if len(set(values)) > 1:
            raise Disagreement(base, values)
        result[base] = values[0]
    return result


def render_skill(
    config: Config,
    code_repo_path: Path,
    version: str,
    template_text: str,
) -> str:
    """Render an installed skill file from a Config + ambient values + template.

    Substitutes every ``{{PLACEHOLDER}}`` in ``template_text`` with the
    corresponding value, drawn from ``config`` (user-preference fields) or
    from ambient parameters (``code_repo_path``).

    Raises:
        UnknownVersion: ``version`` is not a template version this code
            recognises.
        KeyError: the template contains a placeholder this version does not
            know how to fill — indicates a template/code mismatch.
    """
    mapping = _render_mapping(config, code_repo_path, version)
    return PLACEHOLDER_RE.sub(lambda m: mapping[m.group(1)], template_text)


def _render_mapping(
    config: Config, code_repo_path: Path, version: str
) -> dict[str, str]:
    if version == "v0.1.0":
        return {
            "SKILL_NAME": config.skill_name,
            "DATA_REPO_PATH": str(config.data_repo_path),
            "CODE_REPO_PATH": str(code_repo_path),
        }
    raise UnknownVersion(f"Unknown template version: {version!r}")