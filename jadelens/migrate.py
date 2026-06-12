"""Implementation of ``jadelens migrate`` — the migration state machine."""

import subprocess
import sys
import time
from pathlib import Path

from importlib.resources import files

from jadelens import __supported_data_format_version__


# ─── Internal helpers ────────────────────────────────────────────────────────


def _read_data_version(data_repo: Path) -> int | None:
    """Return the integer data version from .jade/version, or None."""
    version_path = data_repo / ".jade" / "version"
    if not version_path.exists():
        return None
    raw = version_path.read_text().strip().lstrip("v")
    try:
        return int(raw)
    except ValueError:
        return None


def _supported_version() -> int:
    try:
        return int(__supported_data_format_version__.lstrip("v"))
    except ValueError:
        raise SystemExit(
            f"Internal error: cannot parse __supported_data_format_version__: "
            f"{__supported_data_format_version__!r}"
        )


def _git(data_repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(data_repo), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _tag_exists(data_repo: Path, tag: str) -> bool:
    return bool(_git(data_repo, "tag", "-l", tag).stdout.strip())


def _push(data_repo: Path) -> None:
    """Push main branch and all tags; retry with exponential backoff."""
    for i, delay in enumerate([0, 2, 4, 8, 16]):
        if delay:
            time.sleep(delay)
        result = _git(data_repo, "push", "origin", "main", "--tags", check=False)
        if result.returncode == 0:
            return
        if i == 4:
            sys.exit(f"git push failed after retries:\n{result.stderr.strip()}")


def _parse_finalize(finalize: str) -> tuple[int, int]:
    """Parse 'vN-v(N+1)' → (N, N+1). Exits cleanly on bad format."""
    _bad = (
        f"Invalid --finalize argument {finalize!r}: expected format vN-v(N+1) "
        f"(e.g. v1-v2)."
    )
    parts = finalize.split("-")
    if len(parts) != 2:
        sys.exit(_bad)
    from_raw, to_raw = parts
    if not from_raw.startswith("v") or not to_raw.startswith("v"):
        sys.exit(_bad)
    try:
        from_ver = int(from_raw[1:])
        to_ver = int(to_raw[1:])
    except ValueError:
        sys.exit(_bad)
    if to_ver != from_ver + 1:
        sys.exit(
            f"Invalid --finalize argument {finalize!r}: "
            f"to-version must be exactly from-version + 1."
        )
    return from_ver, to_ver


# ─── Phase A: finalize ────────────────────────────────────────────────────────


def _phase_a(data_repo: Path, finalize: str) -> None:
    """Seal the migration the bot just finished via the runbook.

    Idempotent — safe to retry after a crash at any step.
    """
    from_ver, to_ver = _parse_finalize(finalize)
    mid = f"v{from_ver}-v{to_ver}"
    s_tag = f"{mid}-migration-start"
    e_tag = f"{mid}-migration-end"

    # 1. Verify start tag exists.
    if not _tag_exists(data_repo, s_tag):
        sys.exit(
            f"Cannot finalize: start tag '{s_tag}' not found.\n"
            f"Was 'jadelens migrate {data_repo}' called to start the migration?"
        )

    # 2. Bump .jade/version from vN to v(N+1) if not already done.
    version_path = data_repo / ".jade" / "version"
    current_raw = version_path.read_text().strip().lstrip("v") if version_path.exists() else ""
    try:
        current_ver = int(current_raw)
    except ValueError:
        current_ver = None

    if current_ver == from_ver:
        version_path.write_text(f"v{to_ver}\n")
        _git(data_repo, "add", ".jade/version")
        _git(data_repo, "commit", "-q", "-m",
             f"migration: bump data format to v{to_ver}")

    # 3. Create end tag at current HEAD if absent.
    if not _tag_exists(data_repo, e_tag):
        _git(data_repo, "tag", e_tag)

    # 4. Push branch + all tags.
    _push(data_repo)


# ─── Phase B: start / resume / done ──────────────────────────────────────────


def _phase_b(data_repo: Path) -> None:
    """Pull, check version, then output the next runbook or DONE."""
    # 1. Pull from remote (best-effort fast-forward).
    _git(data_repo, "pull", "--ff-only", "origin", "main", check=False)

    # 2. Read data version.
    data_ver = _read_data_version(data_repo)
    if data_ver is None:
        sys.exit("Cannot read .jade/version. Is this a valid JADE LENS data repo?")

    # 3. Check if done.
    supported = _supported_version()
    if data_ver == supported:
        print("DONE")
        return

    if data_ver > supported:
        sys.exit(
            f"Data version v{data_ver} is ahead of this CLI "
            f"({__supported_data_format_version__}). Run 'jadelens update'."
        )

    # 4. Target migration data_ver → data_ver+1.
    next_ver = data_ver + 1
    mid = f"v{data_ver}-v{next_ver}"
    s_tag = f"{mid}-migration-start"

    if not _tag_exists(data_repo, s_tag):
        # Fresh start — create and push start tag.
        _git(data_repo, "tag", s_tag)
        _push(data_repo)
    else:
        head = _git(data_repo, "rev-parse", "HEAD").stdout.strip()
        tag_sha = _git(data_repo, "rev-parse", s_tag).stdout.strip()
        if head != tag_sha:
            # HEAD is ahead of start tag — crash recovery.
            _git(data_repo, "reset", "--hard", s_tag)
            _git(data_repo, "pull", "--ff-only", "origin", "main", check=False)
            print(
                f"Rolled back unfinished migration work to `{s_tag}`; "
                "restarting the runbook from a clean state."
            )
        # else: HEAD == start tag, clean resume — no rollback needed.

    # 5. Output runbook.
    migration_dir = f"v{data_ver}_v{next_ver}"
    try:
        runbook_text = (
            files("jadelens")
            .joinpath("migrations", migration_dir, "RUNBOOK.md")
            .read_text()
        )
    except Exception:
        sys.exit(
            f"No runbook found for migration `{mid}`.\n"
            f"This migration is not supported by the installed CLI. "
            f"Run 'jadelens update'."
        )

    print(f"Here's the runbook for migration `{mid}`:\n")
    print(runbook_text, end="")


# ─── Entry point ─────────────────────────────────────────────────────────────


def do_migrate(data_repo: Path, finalize: str | None) -> None:
    """Drive the migration state machine for the data repo.

    Each call advances the migration by at most one step and prints either
    the next runbook for the bot to follow, or ``DONE``.
    """
    if finalize is not None:
        _phase_a(data_repo, finalize)
    _phase_b(data_repo)
