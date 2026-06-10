"""Operations on installed skill files: rendering."""

import re

from jadelens import __version__
from jadelens.config import Config

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z_][A-Z_0-9]*)\}\}")


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
