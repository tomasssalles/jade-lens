#!/usr/bin/env python3
"""Materialize a fresh e2e test scenario from a fixture snapshot.

Usage:
    python tests/e2e/materialize.py <fixture-name> [--github]

Creates /tmp/jl-e2e/<fixture-name>/ (wiped on each run) with:
  home/        fake HOME (uv tool dir, ~/.claude/skills/, etc.)
  remote.git/  bare local remote (local mode only)
  repo/        materialized data repo

See docs/design/e2e-testing.md and tests/e2e/README.md for full details.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
SANDBOX_BASE = Path("/tmp/jl-e2e")
ENV_FILE = REPO_ROOT / ".env.local"

GITHUB_REPO_NAME_PATTERN = re.compile(r"^jade-lens-test(-.+)?$")
MIGRATION_TAG_PATTERN = re.compile(r"^v\d+-v\d+-migration-(start|end)$")


# ── .env.local ───────────────────────────────────────────────────────────────

def read_env_file(path: Path) -> dict[str, str]:
    """Parse a KEY=VALUE file, ignoring blank lines and # comments."""
    result = {}
    if not path.exists():
        return result
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip()
    return result


# ── Git helpers ───────────────────────────────────────────────────────────────

def git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True, text=True, check=check,
    )


# ── Core ──────────────────────────────────────────────────────────────────────

def materialize(fixture_name: str, github: bool) -> None:
    fixture_dir = FIXTURES_DIR / fixture_name
    if not fixture_dir.is_dir():
        sys.exit(f"Fixture not found: {fixture_dir}")

    sandbox = SANDBOX_BASE / fixture_name

    # ── Read and validate GitHub config if needed ─────────────────────────
    repo_url = remote_url = None
    if github:
        env = read_env_file(ENV_FILE)
        repo_url_raw = env.get("VITE_JL_E2E_REPO_URL") or env.get("JL_E2E_REPO_URL")
        pat = env.get("VITE_JL_E2E_PAT") or env.get("JL_E2E_PAT")

        if not repo_url_raw or not pat:
            sys.exit(
                f"--github requires VITE_JL_E2E_REPO_URL and VITE_JL_E2E_PAT "
                f"in {ENV_FILE}.\nCopy .env.local.example to .env.local and fill in the values."
            )

        # Extract owner/repo from URL
        m = re.match(r"https://github\.com/([^/]+)/([^/]+?)(?:\.git)?$", repo_url_raw)
        if not m:
            sys.exit(f"VITE_JL_E2E_REPO_URL must be https://github.com/<owner>/<repo>, got: {repo_url_raw!r}")

        owner, repo_name = m.group(1), m.group(2)

        if not GITHUB_REPO_NAME_PATTERN.match(repo_name):
            sys.exit(
                f"Safety check failed: GitHub repo name {repo_name!r} does not match "
                f"the required pattern r\"jade-lens-test(-.+)?\".\n"
                f"Only repos explicitly created for e2e testing may be force-pushed."
            )

        repo_url = f"https://github.com/{owner}/{repo_name}"
        remote_url = f"https://{pat}@github.com/{owner}/{repo_name}.git"

    # ── Wipe and recreate sandbox ─────────────────────────────────────────
    if sandbox.exists():
        shutil.rmtree(sandbox)
    sandbox.mkdir(parents=True)
    home_dir = sandbox / "home"
    repo_dir = sandbox / "repo"
    home_dir.mkdir()
    repo_dir.mkdir()

    # ── Copy fixture files ────────────────────────────────────────────────
    shutil.copytree(fixture_dir, repo_dir, dirs_exist_ok=True)

    # ── Write scaffold files via jadelens internals ───────────────────────
    config_path = repo_dir / ".jade" / "config.json"
    if not config_path.exists():
        sys.exit(f"Fixture is missing .jade/config.json: {config_path}")
    config_dict = json.loads(config_path.read_text())

    # Import jadelens.cli to call _write_common_files — it's installed.
    sys.path.insert(0, str(REPO_ROOT))
    from jadelens.cli import _write_common_files  # noqa: PLC0415
    _write_common_files(repo_dir, config_dict)

    # ── Git init ──────────────────────────────────────────────────────────
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo_dir)], check=True)
    for k, v in [("user.email", "test@jade-lens.test"), ("user.name", "Test User"),
                 ("commit.gpgsign", "false")]:
        git(repo_dir, "config", k, v)
    git(repo_dir, "add", "-A")
    git(repo_dir, "commit", "-q", "-m", f"materialize: {fixture_name}")

    # ── Set up remote ─────────────────────────────────────────────────────
    if github:
        git(repo_dir, "remote", "add", "origin", remote_url)

        # Clear migration tags from remote before force-pushing
        ls = git(repo_dir, "ls-remote", "--tags", "origin", check=False)
        if ls.returncode == 0:
            tags_to_delete = []
            for line in ls.stdout.splitlines():
                ref = line.split("\t", 1)[-1]  # e.g. refs/tags/v1-v2-migration-start
                tag_name = ref.removeprefix("refs/tags/")
                # Skip peeled refs (^{})
                if tag_name.endswith("^{}"):
                    continue
                if MIGRATION_TAG_PATTERN.match(tag_name):
                    tags_to_delete.append(tag_name)
            if tags_to_delete:
                git(repo_dir, "push", "origin", "--delete", *tags_to_delete)

        git(repo_dir, "push", "--force", "-u", "origin", "main")

    else:
        remote_dir = sandbox / "remote.git"
        subprocess.run(["git", "init", "--bare", "-q", str(remote_dir)], check=True)
        git(repo_dir, "remote", "add", "origin", str(remote_dir))
        git(repo_dir, "push", "-q", "-u", "origin", "main")

    # ── Print summary ─────────────────────────────────────────────────────
    remote_display = repo_url if github else str(sandbox / "remote.git")
    print(f"""
=== Scenario: {fixture_name} ===
Sandbox:   {sandbox}/
Data repo: {repo_dir}/
Remote:    {remote_display}

Run CLI commands in this environment:
  export HOME={home_dir}
  export PATH="$HOME/.local/bin:$PATH"

For bot sessions:
  claude --add-dir {repo_dir}
""")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Materialize a fresh e2e test scenario from a fixture snapshot."
    )
    parser.add_argument("fixture", help="Fixture name (subdirectory of tests/e2e/fixtures/)")
    parser.add_argument("--github", action="store_true",
                        help="Push to GitHub test repo (requires .env.local)")
    args = parser.parse_args()
    materialize(args.fixture, args.github)


if __name__ == "__main__":
    main()
