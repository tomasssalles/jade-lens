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

import argparse
import json
import subprocess
import sys
from importlib.resources import files
from pathlib import Path

from jadelens.config import Config
from jadelens.skill import parse_marker, render_skill

CODE_REPO_PATH = Path(__file__).resolve().parent.parent
SKILLS_DIR = Path.home() / ".claude" / "skills"


def main() -> None:
    parser = argparse.ArgumentParser(prog="jadelens")
    sub = parser.add_subparsers(dest="command")

    render = sub.add_parser(
        "render-skill",
        help="Render the bundled skill template into a data repo's "
             ".claude/skills/<assistant.name>/SKILL.md (no-op if it exists).",
    )
    render.add_argument(
        "data_repo",
        type=Path,
        help="Path to the data repo whose .jade/config.json drives the render.",
    )

    args = parser.parse_args()

    if args.command == "render-skill":
        do_render_skill(args.data_repo.expanduser().resolve())
        return

    # No subcommand: legacy onboarding flow.
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

    assistant_name = prompt_assistant_name()
    data_repo_path = prompt_data_repo_path()
    user_full_name = prompt_user_full_name(data_repo_path)
    user_short_name = prompt_user_short_name(user_full_name)
    config = Config(
        assistant_name=assistant_name,
        data_repo_path=data_repo_path,
        user_full_name=user_full_name,
        user_short_name=user_short_name,
    )

    template_text = latest_template_text()
    version = parse_marker(template_text)
    if version is None:
        sys.exit("BUG: latest bundled template is missing its marker. Please report.")

    rendered = render_skill(config, version, template_text)

    install_dir = SKILLS_DIR / assistant_name
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

    print(f"\n✓ Installed skill '{assistant_name}' at {install_path}")
    print(f"  You can now run /{assistant_name} in any new Claude Code session.")


def prompt_assistant_name() -> str:
    default = "jade"
    while True:
        raw = input(
            f"Assistant name (used as /<name> in Claude Code) [{default}]: "
        ).strip()
        name = raw or default
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


def prompt_user_full_name(data_repo: Path) -> str:
    """Prompt for the user's full name, defaulting to the data repo's
    ``git config user.name`` if available."""
    default = _git_config_user_name(data_repo)
    suffix = f" [{default}]" if default else ""
    while True:
        raw = input(
            f"Your full name (stored when records mention you){suffix}: "
        ).strip()
        name = raw or default
        if not name:
            print("  Invalid: full name required. Try again.")
            continue
        return name


def prompt_user_short_name(full_name: str) -> str:
    """Prompt for a short version of the user's name, defaulting to the
    first whitespace-separated token of the chosen full name."""
    tokens = full_name.split()
    default = tokens[0] if tokens else ""
    suffix = f" [{default}]" if default else ""
    while True:
        raw = input(
            f"Short version (first name or nickname){suffix}: "
        ).strip()
        name = raw or default
        if not name:
            print("  Invalid: short name required. Try again.")
            continue
        return name


def _git_config_user_name(data_repo: Path) -> str:
    """Return the data repo's ``git config user.name``; empty if unset."""
    try:
        result = subprocess.run(
            ["git", "-C", str(data_repo), "config", "user.name"],
            capture_output=True,
            text=True,
            check=True,
            timeout=2,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return ""


def do_render_skill(data_repo: Path) -> None:
    """Render the bundled skill template into
    ``<data-repo>/.claude/skills/<assistant.name>/SKILL.md``.

    Reads ``<data-repo>/.jade/config.json`` for user + assistant fields.
    Per the hook-based bootstrap design, this is a no-op if the target
    SKILL.md already exists — refresh-by-delete is the rebuild loop.

    Exits with a clear message on missing config, invalid JSON, or
    missing required fields, rather than silently rendering a skill
    with `{{undefined}}` placeholders in it.
    """
    if not data_repo.is_dir():
        sys.exit(f"Data repo is not a directory: {data_repo}")

    config_path = data_repo / ".jade" / "config.json"
    if not config_path.is_file():
        sys.exit(f"Missing config file: {config_path}")

    try:
        config_data = json.loads(config_path.read_text())
    except json.JSONDecodeError as e:
        sys.exit(f"Invalid JSON in {config_path}: {e}")

    try:
        assistant_name = config_data["assistant"]["name"]
        user_full_name = config_data["user"]["full_name"]
        user_short_name = config_data["user"]["short_name"]
    except (KeyError, TypeError) as e:
        sys.exit(
            f"Missing or malformed required field in {config_path}. "
            f"Expected shape: "
            f'{{"user": {{"full_name": "...", "short_name": "..."}}, '
            f'"assistant": {{"name": "..."}}}}. Got error: {e!r}'
        )

    try:
        config = Config(
            assistant_name=assistant_name,
            data_repo_path=data_repo,
            user_full_name=user_full_name,
            user_short_name=user_short_name,
        )
    except ValueError as e:
        sys.exit(f"Invalid config in {config_path}: {e}")

    skill_path = (
        data_repo / ".claude" / "skills" / assistant_name / "SKILL.md"
    )
    if skill_path.exists():
        return  # no-op; delete to force a re-render

    template_text = latest_template_text()
    version = parse_marker(template_text)
    if version is None:
        sys.exit("BUG: latest bundled template is missing its marker. Please report.")

    rendered = render_skill(config, version, template_text)
    skill_path.parent.mkdir(parents=True, exist_ok=True)
    skill_path.write_text(rendered)
    print(f"✓ Rendered skill at {skill_path}")


def latest_template_text() -> str:
    """Return the text of the highest-version bundled template.

    Templates live as package resources under ``jadelens/templates/skill/``
    so ``uv tool install`` ships them with the code; ``importlib.resources``
    reads them whether the install is editable or from a built wheel.

    Filenames are ``v<X>.Y.Z.md``. For v0.1.0 there is only one template,
    so any deterministic pick works; a proper semver-aware sort will be
    added when multiple templates ship.
    """
    skill_dir = files("jadelens").joinpath("templates", "skill")
    candidates = [
        f for f in skill_dir.iterdir()
        if f.name.startswith("v") and f.name.endswith(".md")
    ]
    if not candidates:
        sys.exit(
            "BUG: no templates found in jadelens.templates.skill. Please report."
        )
    # TODO: when more than one template ships, sort by semver (vX.Y.Z).
    latest = max(candidates, key=lambda f: f.name)
    return latest.read_text()