"""Operations on installed skill files: rendering and marker parsing."""

import json
import re
from pathlib import Path

from jadelens import __version__
from jadelens.config import Config

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z_][A-Z_0-9]*)\}\}")
_MARKER_RE = re.compile(r"<!--\s*jade-lens-skill\s+cli-version=(\S+)\s*-->")


def is_jade_lens_skill(text: str) -> bool:
    """Return True if text contains the Jade Lens skill marker."""
    return bool(_MARKER_RE.search(text))


def parse_skill_marker_version(data_repo: Path) -> str | None:
    """Return the cli-version from the Jade Lens marker in the rendered skill file.

    Reads ``.jade/config.json`` to find the assistant name, then reads
    ``<data-repo>/.claude/skills/<name>/SKILL.md`` and parses the marker.
    Returns the version string (e.g. ``'v0.1.0'``) or ``None`` if the skill
    file is absent, has no Jade Lens marker, or the config cannot be read.
    """
    try:
        config_data = json.loads((data_repo / ".jade" / "config.json").read_text())
        assistant_name = config_data["assistant"]["name"]
    except Exception:
        return None

    skill_path = data_repo / ".claude" / "skills" / assistant_name / "SKILL.md"
    try:
        content = skill_path.read_text()
    except OSError:
        return None

    m = _MARKER_RE.search(content)
    return m.group(1) if m else None


def render_skill(config: Config, template_text: str) -> str:
    """Render a skill file from a Config and the template text.

    Substitutes every ``{{PLACEHOLDER}}`` in ``template_text`` with the
    corresponding value drawn from ``config`` (plus the CLI version).
    """
    mapping = {
        "ASSISTANT_NAME": config.assistant_name,
        "CLI_VERSION": __version__,
        "DATA_REPO_PATH": str(config.data_repo_path),
        "USER_FULL_NAME": config.user_full_name,
        "USER_SHORT_NAME": config.user_short_name,
    }
    return PLACEHOLDER_RE.sub(lambda m: mapping[m.group(1)], template_text)
