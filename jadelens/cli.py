"""The `jadelens` CLI entry point."""

import argparse
import json
import re
import stat
import subprocess
import sys
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path

from jadelens import __supported_data_format_version__, sync
from jadelens.apply import do_apply
from jadelens.config import Config
from jadelens.operations import dumps_js_canonical
from jadelens.skill import render_skill
from jadelens.stash import describe_operation


def main() -> None:
    # Every subcommand takes the data repo path as its first positional, so it's
    # a shared parent rather than a global pre-subcommand arg (which would read as
    # the unnatural `jadelens <data_repo> <command>`).
    common = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    common.add_argument(
        "data_repo", type=Path, help="Path to the local clone of the data repo."
    )

    parser = argparse.ArgumentParser(prog="jadelens", allow_abbrev=False)
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {version('jadelens')}"
    )
    sub = parser.add_subparsers(dest="command")

    # -- Commands (all take `data_repo` via parents=[common]) --

    # jadelens init <data_repo>
    init = sub.add_parser(
        "init",
        parents=[common],
        help="Interactively clone and initialize a brand new data repo at the provided path.",
    )
    init.add_argument(
        "--ssh-url",
        help="The SSH URL from GitHub to clone your data repository (git@github.com:<username>/<repo>.git).",
    )
    init.add_argument(
        "--assistant-name",
        help="What you want your AI assistant to be called, and also the name of the agentic skill you'll be using (/<assistant-name>).",
    )
    init.add_argument(
        "--user-full-name",
        help="Your full name as you want the assistant to refer to you in more formal records.",
    )
    init.add_argument(
        "--user-short-name",
        help="A short name the assistant will use to refer to you in informal context.",
    )

    # jadelens apply <data_repo>
    _ = sub.add_parser(
        "apply",
        parents=[common],
        help="Apply edits to the data via stdin. This is meant to be used by the AI. Not a human-friendly input format.",
    )

    # jadelens render <data_repo>
    _ = sub.add_parser(
        "render",
        parents=[common],
        help="Render the bundled skill template into a data repo's "
        ".claude/skills/<assistant-name>/SKILL.md (no-op if it exists and is up-to-date).",
    )

    # jadelens stash <data_repo> (--list | --resolve <id>)
    stash = sub.add_parser(
        "stash",
        parents=[common],
        help="List or resolve conflict-stash entries in a data repo's .jade/stash/.",
    )
    stash_action = stash.add_mutually_exclusive_group(required=True)
    stash_action.add_argument("--list", action="store_true", help="List stash entries.")
    stash_action.add_argument(
        "--resolve",
        metavar="ID",
        help="Resolve (delete) the stash entry with this id (filename stem), then sync.",
    )

    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        sys.exit(1)
    data_path = args.data_repo.expanduser().resolve()

    match args.command:
        case "init":
            do_init(
                data_path,
                ssh_url=args.ssh_url,
                assistant_name=args.assistant_name,
                user_full_name=args.user_full_name,
                user_short_name=args.user_short_name,
            )
        case "apply":
            do_apply(data_path)
        case "render":
            do_render_skill(data_path)
        case "stash":
            if args.list:
                do_stash_list(data_path)
            else:
                do_stash_resolve(data_path, args.resolve)


def do_init(
    data_repo_path: Path,
    ssh_url: str | None,
    assistant_name: str | None,
    user_full_name: str | None,
    user_short_name: str | None,
):
    # Make sure the data repo path doesn't exist yet
    if data_repo_path.exists():
        sys.exit(f"Data repo path exists: {data_repo_path}")

    # Validate all provided args before prompting for the ones still missing
    if ssh_url and (error := _get_data_repo_url_error_if_any(ssh_url)):
        sys.exit(f"Invalid SSH URL {ssh_url!r} for GitHub repo: {error}")
    if assistant_name and (error := _get_assistant_name_error_if_any(assistant_name)):
        sys.exit(f"Invalid assistant name {assistant_name!r}: {error}")

    print("\n🟢 Welcome to JADE LENS setup 🟢\n")

    # Prompt for missing args before taking any action on the actual repo
    if not assistant_name:
        assistant_name = prompt_assistant_name()

    # Skill paths. repo_skill_path is the rendered skill dir inside the data repo;
    # global_skill_path is the ~/.claude/skills symlink that makes /<name> work
    # from any session. These paths are only needed for the pre-flight check and
    # the later symlink — the directories themselves are created further down.
    repo_skill_path = data_repo_path / ".claude" / "skills" / assistant_name
    global_skills_dir = Path.home() / ".claude" / "skills"
    global_skill_path = global_skills_dir / assistant_name

    # Bail early if the global skill name is taken by something we shouldn't
    # clobber (an unrelated file/dir, or a symlink pointing elsewhere). A symlink
    # already pointing at our repo_skill_path is fine — it's the steady state.
    if global_skill_path.is_symlink():
        existing_target = global_skill_path.readlink()
        if existing_target != repo_skill_path:
            sys.exit(
                f"A skill named {assistant_name!r} is already symlinked at "
                f"{global_skill_path} → {existing_target}.\n"
                "Remove it (or choose a different assistant name) and try again."
            )
    elif global_skill_path.exists():
        sys.exit(
            f"Something already exists at {global_skill_path} and it isn't a "
            "symlink to this data repo's skill.\n"
            "Remove it (or choose a different assistant name) and try again."
        )

    if not ssh_url:
        ssh_url = prompt_ssh_url()
    if not user_full_name:
        user_full_name = prompt_user_full_name(Path.home())
    if not user_short_name:
        user_short_name = prompt_user_short_name(user_full_name)

    # Clone and verify the data repo
    data_repo_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        _ = subprocess.run(
            ["git", "clone", ssh_url, str(data_repo_path)],
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        sys.exit(f"Failed to clone data repo: {e!r}")

    git_dir = data_repo_path / ".git"
    if not git_dir.is_dir():
        sys.exit(
            f"Something went wrong when cloning the data repo: {git_dir}"
            " does not exist or is not a directory."
        )

    subpaths = [
        p.relative_to(data_repo_path) for p in data_repo_path.iterdir() if p != git_dir
    ]
    if subpaths:
        sys.exit(f"Data repo is not empty! Found: {subpaths}")

    # Write and commit the necessary files
    to_add = []

    # .jade/config.json
    jade_dir = data_repo_path / ".jade"
    jade_dir.mkdir()

    config_dict = {
        "user": {
            "full_name": user_full_name,
            "short_name": user_short_name,
        },
        "assistant": {
            "name": assistant_name,
        },
    }
    config_path = jade_dir / "config.json"
    config_path.write_text(dumps_js_canonical(config_dict))
    to_add.append(config_path)

    # .jade/version — the data-format version currently used in the data repo.
    version_path = jade_dir / "version"
    version_path.write_text(f"{__supported_data_format_version__}\n")
    to_add.append(version_path)

    # Index.json
    index_path = data_repo_path / "Index.json"
    index_path.write_text(dumps_js_canonical([]))
    to_add.append(index_path)

    # .gitignore
    gitignore_path = data_repo_path / ".gitignore"
    gitignore_path.write_text(
        "\n".join(
            (
                "# Rendered skill files",
                ".claude/skills/",
            )
        )
        + "\n"
    )
    to_add.append(gitignore_path)

    # .claude/settings.json
    claude_dir = data_repo_path / ".claude"
    claude_dir.mkdir()

    claude_settings_dict = {
        "hooks": {
            "SessionStart": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start",
                        },
                    ],
                },
            ],
        },
    }
    claude_settings_path = claude_dir / "settings.json"
    claude_settings_path.write_text(dumps_js_canonical(claude_settings_dict))
    to_add.append(claude_settings_path)

    # .claude/hooks/session-start
    hooks_dir = claude_dir / "hooks"
    hooks_dir.mkdir()

    hook_path = hooks_dir / "session-start"
    hook_template_path = files("jadelens").joinpath(
        "templates", "session-start-hook.sh"
    )
    hook_path.write_text(hook_template_path.read_text())
    # Make it executable before git add
    hook_mode = hook_path.stat().st_mode
    hook_path.chmod(hook_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    to_add.append(hook_path)

    # CLAUDE.md
    claude_md_path = data_repo_path / "CLAUDE.md"
    claude_md_template_path = files("jadelens").joinpath(
        "templates", "CLAUDE-template.md"
    )
    claude_md_path.write_text(claude_md_template_path.read_text())
    to_add.append(claude_md_path)

    # Render the skill in <data-repo>/.claude/skills
    # Could be more elegant by extracting the really necessary common code...
    do_render_skill(data_repo_path)

    # Symlink the skill in ~/.claude/skills so /<name> works from any session.
    # We validated above that global_skill_path is either absent or already the
    # symlink we want, so only create it when it isn't there yet.
    global_skills_dir.mkdir(parents=True, exist_ok=True)
    if not global_skill_path.is_symlink():
        global_skill_path.symlink_to(repo_skill_path)
        print(f"✓ Symlinked {global_skill_path} → {repo_skill_path}")

    # Commit and push the bootstrap files. The data repo was empty, so this is
    # its first commit; name the default branch `main` (matching CLAUDE.md's
    # always-work-on-main convention) before committing.
    commit_msg = "Prepared repository for use with Jade Lens."
    _run_git(["branch", "-M", "main"], data_repo_path)
    _run_git(["add", *(str(p) for p in to_add)], data_repo_path)
    _run_git(["commit", "-m", commit_msg], data_repo_path)
    _run_git(["push", "-u", "origin", "main"], data_repo_path)

    print(f"\n✓ Done. Your data repo is ready at {data_repo_path}")
    print(f"  Start a Claude Code session and type /{assistant_name} to begin.")


def _run_git(git_args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    """Run ``git -C <cwd> <git_args>``, exiting with a clear message on failure."""
    try:
        return subprocess.run(
            ["git", "-C", str(cwd), *git_args],
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        )
    except subprocess.CalledProcessError as e:
        sys.exit(f"git {' '.join(git_args)} failed:\n{e.stderr.strip()}")
    except (subprocess.TimeoutExpired, OSError) as e:
        sys.exit(f"git {' '.join(git_args)} failed: {e!r}")


_ssh_url_pattern = re.compile(
    r"(?:git@github\.com:|ssh://git@github\.com/)(?P<user>[^/]+)/(?P<repo>[^/]+)\.git"
)


def _get_data_repo_url_error_if_any(url: str) -> str | None:
    m = _ssh_url_pattern.fullmatch(url)

    if not m:
        return "Wrong format (expected 'git@github.com:<username>/<repo>.git')"

    if (m.group("user") == "tomasssalles") and (m.group("repo") == "jade-lens"):
        return "Wrong repo (this is the code repo from the Jade Lens project)"

    return None


def prompt_ssh_url() -> str:
    print(
        "Paste the SSH URL for your (private) GitHub personal data repository. (If you visit"
        " the repository on GitHub, click on the 'Code' button, tab 'Local', sub-tab 'SSH'.)"
    )
    while True:
        url = input("SSH URL: ").strip()
        if error := _get_data_repo_url_error_if_any(url):
            print(f"  {error}")
            continue
        return url


def _get_assistant_name_error_if_any(name: str) -> str | None:
    if "/" in name:
        return "Invalid character '/' in assistant name"

    if any(c.isspace() for c in name):
        return "Invalid: Assistant name cannot contain whitespace"


def prompt_assistant_name() -> str:
    default = "jade"
    while True:
        raw = input(
            f"Assistant name (used as /<name> in Claude Code) [{default}]: "
        ).strip()
        name = raw or default
        if error := _get_assistant_name_error_if_any(name):
            print(f"  {error}")
            continue
        return name


def prompt_user_full_name(git_working_dir: Path) -> str:
    """Prompt for the user's full name, defaulting to the working dir's
    ``git config user.name`` if available."""
    default = _git_config_user_name(git_working_dir)
    suffix = f" [{default}]" if default else ""
    while True:
        raw = input(
            f"Your full name (used when more formal records mention you){suffix}: "
        ).strip()
        name = raw or default
        if not name:
            print("  Invalid: full name is required.")
            continue
        return name


def prompt_user_short_name(full_name: str) -> str:
    """Prompt for a short version of the user's name, defaulting to the
    first whitespace-separated token of the chosen full name."""
    tokens = full_name.split()
    default = tokens[0] if tokens else ""
    suffix = f" [{default}]" if default else ""
    while True:
        raw = input(f"Short version (first name or nickname){suffix}: ").strip()
        name = raw or default
        if not name:
            print("  Invalid: short name required. Try again.")
            continue
        return name


def _git_config_user_name(working_dir: Path) -> str:
    """Return ``git config user.name`` as defined for the working_dir (may be local);
    empty if unset."""
    try:
        result = subprocess.run(
            ["git", "-C", str(working_dir), "config", "user.name"],
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

    skill_path = data_repo / ".claude" / "skills" / assistant_name / "SKILL.md"
    if skill_path.exists():
        return  # no-op; delete to force a re-render

    template_text = files("jadelens").joinpath("templates", "skill.md").read_text()
    rendered = render_skill(config, template_text)
    skill_path.parent.mkdir(parents=True, exist_ok=True)
    skill_path.write_text(rendered)
    print(f"✓ Rendered skill at {skill_path}")


def do_stash_list(data_repo: Path) -> None:
    """Print the data repo's conflict-stash entries. Best-effort pull first so
    entries created on other devices are visible."""
    if not (data_repo / ".jade").is_dir():
        sys.exit(f"Not a jade data repo (no .jade/): {data_repo}")
    try:
        sync.pull(data_repo)
    except sync.SyncError:
        pass

    entries = sync.list_stash(data_repo)
    if not entries:
        print("No stashed changes.")
        return
    for stash_id, entry in entries:
        ts = entry.get("timestamp", "?") if entry else "?"
        print(f"\n{stash_id}  ({ts})")
        if not entry:
            print("  (unreadable stash entry)")
            continue
        for op in entry.get("operations", []):
            print(f"  - {describe_operation(op)}")
    print(
        "\nResolve with: jadelens stash <data_repo> --resolve <id>  "
        "(deletes the entry — both 'done' and 'won't do')."
    )


def do_stash_resolve(data_repo: Path, stash_id: str) -> None:
    """Resolve (delete) a stash entry by id and sync the deletion."""
    if not (data_repo / ".jade").is_dir():
        sys.exit(f"Not a jade data repo (no .jade/): {data_repo}")
    try:
        sync.resolve_stash(data_repo, stash_id)
    except sync.SyncError as e:
        sys.exit(f"Could not resolve stash entry: {e}")
    print(f"✓ Resolved stash entry {stash_id}")
