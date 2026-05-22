"""Wikilink reference scanning and rewriting.

Wikilinks are written as ``[[path]]`` where ``path`` is relative to the
data-repo root (DESIGN.md §4.3). The bot uses them to reference data-repo
files from other data-repo files (in markdown prose or JSON string values).

The runtime keeps wikilink references consistent across structural
mutations via a **post-apply pass** at the end of every batch (see
``workflow.run``):

- For each ``rename_path``: rewrite remaining wikilinks pointing at the
  old path (or anything under it) so they point at the new location.
- For each ``delete_path``: scan for wikilinks still pointing at the
  deleted path; if any remain, raise — the bot must include the cleanup
  in the same batch (in any order — the post-pass only sees what
  survived to the end of the batch, so a clean-up ``unified_diff``
  later in the same batch satisfies the check).

Scans only **git-visible** files: tracked + untracked-but-not-gitignored.
This means
(a) the user's own gitignored scratch files are never touched, and
(b) any rewrites we do are safely revertable by ``git reset --hard``
(which only restores tracked files; gitignored ones it can't restore).
"""

import posixpath
import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Iterator

from jadelens.operations import EDITABLE_FILE_SUFFIXES

WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


def find_references(data_repo: Path, target: str) -> list[tuple[Path, str]]:
    """Return every wikilink pointing to ``target`` or anything under it.

    Tuples are ``(referencing_file, linked_path)`` — suitable for human-
    readable error messages. Files that no longer exist (e.g. because the
    batch's earlier ops deleted them) are naturally absent from the scan.
    """
    refs: list[tuple[Path, str]] = []
    for f in _scannable_files(data_repo):
        for link_path in _wikilink_paths(f):
            if _refers_to(link_path, target):
                refs.append((f, link_path))
    return refs


def rewrite_references_under(
    data_repo: Path, from_path: str, to_path: str
) -> list[Path]:
    """Rewrite every wikilink whose path is ``from_path`` or starts with
    ``from_path + "/"`` to point at the new location. Returns the list of
    files that were modified."""
    modified: list[Path] = []
    for f in _scannable_files(data_repo):
        original = f.read_text()
        rewritten = WIKILINK_RE.sub(
            lambda m: _rewrite_one(m.group(1), from_path, to_path),
            original,
        )
        if rewritten != original:
            f.write_text(rewritten)
            modified.append(f)
    return modified


# ---------------------- internals ----------------------


def _refers_to(link_path: str, target: str) -> bool:
    """Does ``link_path`` reference ``target`` (or anything under it,
    treating target as a possible directory prefix)?

    Both paths are logically normalised (``..`` and ``.`` resolved,
    trailing slashes stripped) so e.g. ``bar/../foo.md`` matches
    ``foo.md`` and ``foo/`` matches ``foo``.
    """
    link = _norm(link_path)
    tgt = _norm(target)
    return link == tgt or tgt in link.parents


def _rewrite_one(link_path: str, from_path: str, to_path: str) -> str:
    """Return the replacement text for one wikilink occurrence."""
    link = _norm(link_path)
    src = _norm(from_path)
    dst = _norm(to_path)
    if link == src:
        return f"[[{dst}]]"
    if src in link.parents:
        return f"[[{dst / link.relative_to(src)}]]"
    return f"[[{link_path}]]"  # unchanged — preserve the bot's original form


def _norm(path: str) -> PurePosixPath:
    """Logical path normalisation without touching the filesystem."""
    return PurePosixPath(posixpath.normpath(path))


def _wikilink_paths(file: Path) -> list[str]:
    return WIKILINK_RE.findall(file.read_text())


def _scannable_files(data_repo: Path) -> Iterator[Path]:
    """Yield every git-visible ``.json`` / ``.md`` file in the data repo.

    ``git ls-files --cached --others --exclude-standard`` lists tracked
    files PLUS untracked-but-not-gitignored ones. Gitignored files (and
    anything under ``.git/``) are excluded — we never touch the user's
    private scratch files, and our rewrites stay revertable via
    ``git reset --hard`` (which only restores tracked content).
    """
    result = subprocess.run(
        [
            "git", "-C", str(data_repo), "ls-files",
            "--cached", "--others", "--exclude-standard",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    for relative in result.stdout.splitlines():
        if not relative.endswith(EDITABLE_FILE_SUFFIXES):
            continue
        f = data_repo / relative
        if f.is_file():
            yield f