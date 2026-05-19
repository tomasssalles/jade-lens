"""The `jadelens` CLI entry point.

State-aware: scans ``~/.claude/skills/`` for jade-lens installs and branches:

- 0 found → onboarding (prompt for values, render latest template, write).
- 1 found → update / config-edit / rename (NOT YET IMPLEMENTED in v0.1.0).
- 2+ found → list and pick (NOT YET IMPLEMENTED in v0.1.0).

Before any of that, performs a best-effort ``git fetch`` against the code
repo and prints a one-line nudge if origin is ahead. The nudge is purely
informative; the user runs ``git pull`` themselves when they're ready.

Requires editable install (``uv tool install --editable .``) so that
``__file__``-relative paths resolve to the live code repo for templates and
for the git-fetch check.
"""

import subprocess
import sys
from pathlib import Path

from jadelens.config import Config
from jadelens.skill import parse_marker, render_skill

CODE_REPO_PATH = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = CODE_REPO_PATH / "templates" / "skill"
SKILLS_DIR = Path.home() / ".claude" / "skills"


def main() -> None:
    check_for_updates(CODE_REPO_PATH)
    installs = scan_for_installs(SKILLS_DIR)

    print("\n🟢 Welcome to JADE LENS setup 🟢\n")

    if not installs:
        do_onboarding()
    elif len(installs) == 1:
        print(
            "An existing jade-lens skill was found at:\n"
            f"  {installs[0]}\n"
            "Update / config-edit / rename flows are not yet implemented in "
            "v0.1.0. Coming soon."
        )
    else:
        print(
            f"{len(installs)} jade-lens skills found:\n"
            + "".join(f"  {p}\n" for p in installs)
            + "Multi-install handling is not yet implemented in v0.1.0. "
            "Coming soon."
        )


def check_for_updates(code_repo_path: Path) -> None:
    """Print a nudge if the code repo's tracked upstream has new commits.

    Best-effort: fails silently on network issues, missing upstream, or any
    other error. Never blocks the rest of the flow.
    """
    print("Checking for updates...")
    try:
        subprocess.run(
            ["git", "-C", str(code_repo_path), "fetch", "--quiet"],
            timeout=5,
            check=True,
            capture_output=True,
        )
        result = subprocess.run(
            ["git", "-C", str(code_repo_path), "rev-list", "--count", "HEAD..@{u}"],
            timeout=2,
            check=True,
            capture_output=True,
            text=True,
        )
        behind = int(result.stdout.strip())
        if behind > 0:
            plural = "s" if behind != 1 else ""
            print(
                f"\n⚠ {behind} new commit{plural} on origin. To update: "
                f"`cd {code_repo_path} && git pull && jadelens`.\n"
            )
            response = input("Continue without updating? [y/N]: ").strip().lower()
            if response != "y":
                sys.exit("Aborting.")
    except (subprocess.SubprocessError, OSError, ValueError):
        pass


def scan_for_installs(skills_dir: Path) -> list[Path]:
    """Return paths to SKILL.md files in ``skills_dir/*/`` that carry the
    jade-lens marker."""
    print("Searching for installed jade-lens skills...")
    if not skills_dir.is_dir():
        return []
    return [
        skill_md
        for skill_md in skills_dir.glob("*/SKILL.md")
        if parse_marker(skill_md.read_text()) is not None
    ]


def do_onboarding() -> None:
    print("No installed skill detected. Let's create one.\n")

    skill_name = prompt_skill_name()
    data_repo_path = prompt_data_repo_path()
    config = Config(skill_name=skill_name, data_repo_path=data_repo_path)

    template_path = latest_template_path()
    template_text = template_path.read_text()
    version = parse_marker(template_text)
    if version is None:
        sys.exit(
            f"BUG: template {template_path} is missing its marker. "
            f"Please report."
        )

    rendered = render_skill(config, CODE_REPO_PATH, version, template_text)

    install_dir = SKILLS_DIR / skill_name
    install_path = install_dir / "SKILL.md"

    if install_path.exists():
        print(
            f"\n⚠ A file already exists at {install_path}, but it doesn't "
            f"have the jade-lens marker."
        )
        response = input("Overwrite it? [y/N]: ").strip().lower()
        if response != "y":
            sys.exit("Aborting.")

    install_dir.mkdir(parents=True, exist_ok=True)
    install_path.write_text(rendered)

    print(f"\n✓ Installed skill '{skill_name}' at {install_path}")
    print(f"  You can now run /{skill_name} in any new Claude Code session.")


def prompt_skill_name() -> str:
    while True:
        raw = input(
            "Skill name (used as /<name> in Claude Code) [default=jade]: "
        ).strip()
        name = raw or "jade"
        if "/" in name or " " in name:
            print("  Invalid: must not contain slashes or spaces. Try again.")
            continue
        return name


def prompt_data_repo_path() -> Path:
    while True:
        raw = input("Path to your data repo's local clone: ").strip()
        if not raw:
            print("  Invalid: path required. Try again.")
            continue
        # Accept relative, ~, etc.; resolve to absolute for storage.
        path = Path(raw).expanduser().resolve()
        if not path.is_dir():
            print(f"  Invalid: {path} is not an existing directory. Try again.")
            continue
        if not (path / ".git").exists():
            print(
                f"  Invalid: {path} is not a git repo (no .git found). Try again."
            )
            continue
        return path


def latest_template_path() -> Path:
    """Return the highest-version template file in ``TEMPLATES_DIR``.

    Versions are like ``v0.1.0`` (stem of the filename). For v0.1.0 there is
    only one template, so any deterministic pick works; a proper version-aware
    sort will be added when multiple templates ship.
    """
    path = max(TEMPLATES_DIR.glob("v*.md"), default=None)
    if not path:
        sys.exit(
            f"BUG: no templates found in {TEMPLATES_DIR}. Please report."
        )
    # TODO: when more than one template ships, sort by semver (vX.Y.Z).
    return path