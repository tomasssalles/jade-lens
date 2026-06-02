"""Auto-sync + conflict/stash flow for the ``/jade`` client, against a real
local git clone (Phase 4 of docs/mutation-sync-implementation-plan.md; design in
docs/sync-and-conflicts.md §2–§5).

Shape (mirrors the web app's operation-queue reconciliation, with git as the
substrate):

- ``pull(repo)`` before processing — fetch and fast-forward when the remote is
  cleanly ahead.
- ``push(repo)`` after committing — push; on a non-fast-forward rejection,
  reconcile: if the local commits and the remote touch **disjoint** data files,
  rebase onto the remote and push; if they touch a **common** file, the local
  work is **stashed** (`.jade/stash/`) and the branch reset to the remote.

Conflict detection is file-level and **ignores `.jade/`** (the ops-log, stash,
version are runtime bookkeeping, not user data — exactly as the web client's
detection keys off operation paths, which can never target `.jade/`). The
append-only operations log would otherwise collide on every push; we union-merge
it (a local `.git/info/attributes` rule) so rebases never conflict on it.

> **Simplification (documented).** The web client stashes "from the first
> conflicting batch onward," keeping the non-conflicting prefix. Here, if *any*
> unpushed commit conflicts, **all** unpushed commits are stashed (whole) and the
> branch reset to the remote. This is always safe (no data loss — everything
> conflicting or after it is preserved in the stash) and exact for the common
> ``/jade`` case of a single unpushed commit (it pushes after every
> interaction). Finer-grained partial-keep parity with the web is a Phase 6
> refinement.
"""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from jadelens.stash import (
    build_stash_entry,
    serialize_stash_entry,
    stash_filename,
)


class SyncError(Exception):
    """A git/sync plumbing failure."""


@dataclass(frozen=True)
class SyncResult:
    action: str  # local-only | offline | up-to-date | fast-forwarded | diverged
    #              | pushed | rebased | stashed
    stashed: int = 0


def _git(repo: Path, args: list[str], check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise SyncError(f"`git {' '.join(args)}` failed: {result.stderr.strip()}")
    return result.stdout


def _git_raw(repo: Path, args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True
    )


def has_origin(repo: Path) -> bool:
    return "origin" in _git(repo, ["remote"]).split()


def current_branch(repo: Path) -> str:
    return _git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).strip()


def _rev_count(repo: Path, rng: str) -> int:
    return int(_git(repo, ["rev-list", "--count", rng]).strip() or "0")


def _merge_base(repo: Path, a: str, b: str) -> str:
    return _git(repo, ["merge-base", a, b]).strip()


def _is_protected(path: str) -> bool:
    """A top-level dot-prefixed path (.jade/, .claude/, .gitignore, …) — runtime
    bookkeeping, excluded from file-level conflict detection."""
    first = path.split("/", 1)[0]
    return first.startswith(".")


def _changed_data_files(repo: Path, a: str, b: str) -> set[str]:
    """Data files changed between two refs, excluding protected `.`-paths."""
    out = _git(repo, ["diff", "--name-only", "-z", a, b])
    return {p for p in out.split("\0") if p and not _is_protected(p)}


def _tree_paths(repo: Path, ref: str) -> list[str]:
    out = _git(repo, ["ls-tree", "-r", "--name-only", "-z", ref])
    return [p for p in out.split("\0") if p]


def _show_or_empty(repo: Path, ref: str, path: str) -> str:
    cp = _git_raw(repo, ["show", f"{ref}:{path}"])
    return cp.stdout if cp.returncode == 0 else ""


def _version(repo: Path) -> str:
    return (repo / ".jade" / "version").read_text().strip()


def _ensure_union_attr(repo: Path) -> None:
    """Union-merge the append-only operations log so rebases never conflict on it
    (both sides only ever append). Local-only (`.git/info/attributes`), not a
    tracked file."""
    info = repo / ".git" / "info"
    info.mkdir(parents=True, exist_ok=True)
    rule = ".jade/operations-log/*.jsonl merge=union\n"
    attrs = info / "attributes"
    existing = attrs.read_text() if attrs.exists() else ""
    if rule not in existing:
        attrs.write_text(existing + rule)


def _unpushed_batches(repo: Path, base: str, head: str) -> list[dict]:
    """The batches (``{ts, operations}``) recorded by the commits in
    ``base..head``, recovered from the operations-log lines they appended.
    Append-only ⇒ the base log is a prefix of the head log; the suffix is what
    the unpushed commits added."""
    log_path = f".jade/operations-log/{_version(repo)}.jsonl"
    base_log = _show_or_empty(repo, base, log_path)
    head_log = _show_or_empty(repo, head, log_path)
    added = head_log[len(base_log):] if head_log.startswith(base_log) else head_log
    return [json.loads(line) for line in added.splitlines() if line.strip()]


def _try_push(repo: Path, branch: str) -> subprocess.CompletedProcess:
    return _git_raw(repo, ["push", "origin", f"HEAD:{branch}"])


def _is_non_fast_forward(stderr: str) -> bool:
    s = stderr.lower()
    return "non-fast-forward" in s or "fetch first" in s or "rejected" in s


def fetch(repo: Path, branch: str) -> None:
    cp = _git_raw(repo, ["fetch", "origin", branch])
    if cp.returncode != 0:
        raise SyncError(f"git fetch failed: {cp.stderr.strip()}")


def pull(repo: Path) -> SyncResult:
    """Fetch and fast-forward when the remote is cleanly ahead (no local
    divergence). Best-effort: a network failure is reported as ``offline``, not
    raised. A divergence is left for ``push`` to reconcile."""
    if not has_origin(repo):
        return SyncResult(action="local-only")
    branch = current_branch(repo)
    try:
        fetch(repo, branch)
    except SyncError:
        return SyncResult(action="offline")
    remote = f"origin/{branch}"
    behind = _rev_count(repo, f"HEAD..{remote}")
    ahead = _rev_count(repo, f"{remote}..HEAD")
    if behind > 0 and ahead == 0:
        _git(repo, ["merge", "--ff-only", remote])
        return SyncResult(action="fast-forwarded")
    if ahead > 0 and behind > 0:
        return SyncResult(action="diverged")
    return SyncResult(action="up-to-date")


def _write_stash_files(repo: Path, base: str, batches: list[dict]) -> list[str]:
    """Build + write a stash file per batch, returning the repo-relative paths.
    Ancestors come from the merge-base tree (the pristine pre-divergence base)."""
    base_content = {p: _show_or_empty(repo, base, p) for p in _tree_paths(repo, base)}
    written: list[str] = []
    for batch in batches:
        entry = build_stash_entry(batch["operations"], batch["ts"], base_content)
        rel = stash_filename(batch["ts"])
        target = repo / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(serialize_stash_entry(entry))
        written.append(rel)
    return written


def _stash_commit_message(n: int) -> str:
    return f"Stash {n} conflicting local change{'' if n == 1 else 's'}"


def push(repo: Path) -> SyncResult:
    """Push the current branch; reconcile a non-fast-forward rejection by rebase
    (disjoint files) or stash (file-level conflict). Assumes a clean tree (the
    batch has already been committed by ``workflow.run``)."""
    if not has_origin(repo):
        return SyncResult(action="local-only")
    branch = current_branch(repo)

    cp = _try_push(repo, branch)
    if cp.returncode == 0:
        return SyncResult(action="pushed")
    if not _is_non_fast_forward(cp.stderr):
        raise SyncError(f"git push failed: {cp.stderr.strip()}")

    # Remote advanced under us — fetch and reconcile.
    fetch(repo, branch)
    remote = f"origin/{branch}"
    base = _merge_base(repo, "HEAD", remote)
    conflict = bool(
        _changed_data_files(repo, base, "HEAD") & _changed_data_files(repo, base, remote)
    )

    if not conflict:
        _ensure_union_attr(repo)
        rebase = _git_raw(repo, ["rebase", remote])
        if rebase.returncode == 0:
            _push_or_raise(repo, branch)
            return SyncResult(action="rebased")
        _git_raw(repo, ["rebase", "--abort"])  # fall back to stashing everything

    # Recover the unpushed batches' operations BEFORE the reset moves HEAD, then
    # discard the local commits (and their ops-log lines) and re-anchor on remote.
    batches = _unpushed_batches(repo, base, "HEAD")
    _git(repo, ["reset", "--hard", remote])
    # Write the stash files (ancestors from the still-reachable merge-base) and
    # commit them as bookkeeping — no ops-log line (§5: stash is never logged).
    stash_paths = _write_stash_files(repo, base, batches)
    _git(repo, ["add", "--", *stash_paths])
    _git(repo, ["commit", "-q", "-m", _stash_commit_message(len(stash_paths))])
    _push_or_raise(repo, branch)
    return SyncResult(action="stashed", stashed=len(stash_paths))


def _push_or_raise(repo: Path, branch: str) -> None:
    cp = _try_push(repo, branch)
    if cp.returncode != 0:
        raise SyncError(f"git push failed after reconcile: {cp.stderr.strip()}")


# ---------- Stash management (the bot's only access to .jade/stash/) ----------


def list_stash(repo: Path) -> list[tuple[str, dict | None]]:
    """Every stash entry as ``(id, parsed_entry)``, chronologically sorted. The
    id is the filename stem (``<compactISO>-<shortuuid>``); ``entry`` is None if
    the file fails to parse."""
    stash_dir = repo / ".jade" / "stash"
    if not stash_dir.is_dir():
        return []
    out: list[tuple[str, dict | None]] = []
    for f in sorted(stash_dir.glob("*.json")):
        try:
            entry = json.loads(f.read_text())
        except json.JSONDecodeError:
            entry = None
        out.append((f.stem, entry))
    return out


def resolve_stash(repo: Path, stash_id: str) -> SyncResult:
    """Resolve (delete) a stash entry and sync the deletion — both "Done" and
    "Won't do" route here. A normal bookkeeping commit (no ops-log line);
    deleting under `.jade/stash/` never registers as a data conflict, so the
    sync rebases cleanly if the remote has advanced."""
    rel = f".jade/stash/{stash_id}.json"
    if not (repo / rel).exists():
        raise SyncError(f"No such stash entry: {stash_id}")
    _git(repo, ["rm", "-q", "--", rel])
    _git(repo, ["commit", "-q", "-m", f"Resolve stash entry {stash_id}"])
    return push(repo)
