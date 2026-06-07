"""Python runner for the cross-client mutation conformance suite.

Each fixture in ``conformance/cases/*.json`` is fed through the real
``jadelens`` mutation pipeline (``workflow.run``) against a throwaway git
repo, and the outcome — resulting files, or rejection code — is compared to
the fixture's expectation. See ``conformance/README.md`` for the contract.

Run with: ``uv run pytest conformance/runners/python``
"""

import json
import subprocess
from pathlib import Path

import pytest

from jadelens import __supported_data_format_version__
from jadelens.operations import ConformanceError
from jadelens.workflow import run

# conformance/runners/python/test_conformance.py → conformance/
CONFORMANCE_ROOT = Path(__file__).resolve().parents[2]
CASES_DIR = CONFORMANCE_ROOT / "cases"

# The data version the suite assumes
DEFAULT_DATA_VERSION = __supported_data_format_version__

TS_SENTINEL = "<TS>"
LOG_DIR_PREFIX = ".jade/operations-log/"


def _load_cases():
    paths = sorted(CASES_DIR.glob("*.json"))
    return [pytest.param(json.loads(p.read_text()), id=p.stem) for p in paths]


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _seed_repo(repo: Path, before: dict[str, str]) -> None:
    """Create a git repo, write the version file + `before`, commit it clean.

    Identity and signing are pinned as *repo-local* config (not via per-call
    ``-c`` flags) so that the production ``git commit`` inside ``workflow.run``
    inherits them too. This makes the runner self-contained regardless of the
    caller's global git config (e.g. environments that force commit signing).
    """
    _git(repo, "init", "-q")
    _git(repo, "config", "user.name", "conformance")
    _git(repo, "config", "user.email", "conformance@example.com")
    _git(repo, "config", "commit.gpgsign", "false")
    # .jade/version unless the case provides its own.
    if ".jade/version" not in before:
        version_file = repo / ".jade" / "version"
        version_file.parent.mkdir(parents=True, exist_ok=True)
        version_file.write_text(DEFAULT_DATA_VERSION + "\n")
    for rel, content in before.items():
        f = repo / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "seed")


def _read_tree(repo: Path) -> dict[str, str]:
    """Read every non-.git file in the repo into a {relpath: content} map."""
    out: dict[str, str] = {}
    for p in repo.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(repo).as_posix()
        if rel.startswith(".git/") or rel == ".git":
            continue
        out[rel] = p.read_text()
    return out


def _normalise(rel: str, content: str) -> str:
    """Normalise a file's content for comparison.

    Operations-log lines are compared structurally (parsed, with the
    timestamp blanked) rather than byte-wise, since serialiser whitespace
    isn't part of the contract (README §4).
    """
    if rel.startswith(LOG_DIR_PREFIX):
        lines = []
        for line in content.splitlines():
            if not line.strip():
                continue
            entry = json.loads(line)
            if "ts" in entry:
                entry["ts"] = TS_SENTINEL
            lines.append(json.dumps(entry, sort_keys=True))
        return "\n".join(lines)
    return content


def _normalise_tree(tree: dict[str, str]) -> dict[str, str]:
    return {rel: _normalise(rel, content) for rel, content in tree.items()}


CASES = _load_cases()


@pytest.mark.parametrize("case", CASES)
def test_conformance(case, tmp_path):
    repo = tmp_path / "data"
    repo.mkdir()
    before = case["before"]
    _seed_repo(repo, before)

    expect = case["expect"]
    # The version file is a runner-seeded precondition, not part of `before`'s
    # contract — exclude it from the expected set unless the case named it.
    seeded_extra = set()
    if ".jade/version" not in before:
        seeded_extra.add(".jade/version")

    if "error" in expect:
        with pytest.raises(ConformanceError) as exc_info:
            run(repo, case["operations"], case.get("commit_message", ""))
        assert exc_info.value.code == expect["error"], (
            f"expected error code {expect['error']!r}, got {exc_info.value.code!r}"
        )
        # Atomicity: nothing changed relative to the seeded state.
        actual = {
            rel: c for rel, c in _read_tree(repo).items() if rel not in seeded_extra
        }
        assert _normalise_tree(actual) == _normalise_tree(before), (
            "rejected batch must leave the repo byte-for-byte unchanged"
        )
    else:
        run(repo, case["operations"], case.get("commit_message", ""))
        actual = {
            rel: c for rel, c in _read_tree(repo).items() if rel not in seeded_extra
        }
        assert _normalise_tree(actual) == _normalise_tree(expect["after"])
