"""Tests for jadelens.wikilinks."""

from pathlib import Path

from jadelens.wikilinks import find_references, rewrite_references_under
from tests.conftest import commit


# ====================================================================
# find_references
# ====================================================================


def test_finds_references_in_md_files(data_repo: Path):
    (data_repo / "ref1.md").write_text("see [[target.md]] for details")
    (data_repo / "ref2.md").write_text("also [[target.md]] mentioned here")
    (data_repo / "unrelated.md").write_text("nothing here")
    commit(data_repo)
    refs = find_references(data_repo, "target.md")
    assert {f.name for f, _ in refs} == {"ref1.md", "ref2.md"}


def test_finds_references_in_json_files(data_repo: Path):
    (data_repo / "data.json").write_text('{"link": "[[target.md]]"}')
    commit(data_repo)
    refs = find_references(data_repo, "target.md")
    assert len(refs) == 1
    assert refs[0][0].name == "data.json"


def test_finds_references_under_directory_target(data_repo: Path):
    (data_repo / "ref.md").write_text(
        "[[projects/leasing/notes.md]] and [[projects/leasing/cars.json]]"
    )
    commit(data_repo)
    refs = find_references(data_repo, "projects/leasing")
    assert len(refs) == 2


def test_doesnt_false_positive_on_similar_name_prefix(data_repo: Path):
    """Target 'foo' must NOT match wikilinks like '[[foobar.md]]' or
    '[[foobar/a.md]]' — only exact match or proper directory prefix."""
    (data_repo / "ref.md").write_text("[[foobar.md]] and [[foobar/a.md]]")
    commit(data_repo)
    assert find_references(data_repo, "foo") == []


def test_finds_matches_target_with_trailing_slash(data_repo: Path):
    (data_repo / "ref.md").write_text("[[foo]] is here")
    commit(data_repo)
    # Caller passes a directory-style target with trailing slash.
    refs = find_references(data_repo, "foo/")
    assert len(refs) == 1


def test_finds_wikilinks_using_dot_dot(data_repo: Path):
    """A wikilink emitted in unusual denormalised form
    (``bar/../foo.md``) still resolves to ``foo.md`` for matching."""
    (data_repo / "ref.md").write_text("see [[bar/../foo.md]] please")
    commit(data_repo)
    refs = find_references(data_repo, "foo.md")
    assert len(refs) == 1


def test_finds_wikilinks_using_leading_dot(data_repo: Path):
    (data_repo / "ref.md").write_text("see [[./foo.md]] please")
    commit(data_repo)
    refs = find_references(data_repo, "foo.md")
    assert len(refs) == 1


def test_skips_gitignored_files(data_repo: Path):
    """Gitignored files must never be scanned — they may be the user's
    own scratch notes, and we can't safely revert them on failure."""
    (data_repo / ".gitignore").write_text("private.md\n")
    (data_repo / "private.md").write_text("[[target.md]] in my notes")
    (data_repo / "tracked.md").write_text("[[target.md]] in tracked file")
    commit(data_repo)
    refs = find_references(data_repo, "target.md")
    assert len(refs) == 1
    assert refs[0][0].name == "tracked.md"


def test_finds_in_untracked_but_not_ignored_files(data_repo: Path):
    """A new file created in this batch (still untracked, but not
    gitignored) IS in scope — its references count toward the check."""
    (data_repo / "new.md").write_text("[[target.md]] in new untracked file")
    # No commit — file is untracked but not gitignored.
    refs = find_references(data_repo, "target.md")
    assert len(refs) == 1


def test_returns_empty_when_no_references(data_repo: Path):
    (data_repo / "ref.md").write_text("no wikilinks here at all")
    commit(data_repo)
    assert find_references(data_repo, "target.md") == []


# ====================================================================
# rewrite_references_under
# ====================================================================


def test_rewrites_references_in_md(data_repo: Path):
    (data_repo / "ref.md").write_text("see [[old.md]] for details")
    commit(data_repo)
    modified = rewrite_references_under(data_repo, "old.md", "new.md")
    assert len(modified) == 1
    assert (data_repo / "ref.md").read_text() == "see [[new.md]] for details"


def test_rewrites_references_in_json(data_repo: Path):
    (data_repo / "data.json").write_text('{"link": "[[old.md]]"}')
    commit(data_repo)
    rewrite_references_under(data_repo, "old.md", "new.md")
    assert (data_repo / "data.json").read_text() == '{"link": "[[new.md]]"}'


def test_directory_rename_rewrites_deeply_nested_refs(data_repo: Path):
    """Rename 'projects' → 'archive' — wikilinks two levels under the
    renamed directory get their prefix swapped, preserving the remaining
    sub-path."""
    (data_repo / "ref.md").write_text(
        "see [[projects/leasing/notes.md]] and [[projects/leasing/cars.json]]"
    )
    commit(data_repo)
    rewrite_references_under(data_repo, "projects", "archive")
    assert (
        (data_repo / "ref.md").read_text()
        == "see [[archive/leasing/notes.md]] and [[archive/leasing/cars.json]]"
    )


def test_leaves_unrelated_files_alone(data_repo: Path):
    (data_repo / "ref.md").write_text("see [[old.md]] here")
    (data_repo / "other.md").write_text("nothing related")
    commit(data_repo)
    modified = rewrite_references_under(data_repo, "old.md", "new.md")
    assert {f.name for f in modified} == {"ref.md"}


def test_rewrites_denormalised_input_to_clean_output(data_repo: Path):
    """If the bot emitted a denormalised wikilink (``bar/../foo.md``) that
    matches the rename source, the REWRITTEN output uses the clean form."""
    (data_repo / "ref.md").write_text("see [[bar/../old.md]] please")
    commit(data_repo)
    rewrite_references_under(data_repo, "old.md", "new.md")
    assert (data_repo / "ref.md").read_text() == "see [[new.md]] please"


def test_doesnt_touch_gitignored_files(data_repo: Path):
    """Gitignored files must never be modified, even if they contain
    matching wikilinks — they're the user's private space, and we can't
    revert them on failure."""
    (data_repo / ".gitignore").write_text("private.md\n")
    (data_repo / "private.md").write_text("[[old.md]] in my notes")
    (data_repo / "tracked.md").write_text("[[old.md]] in tracked")
    commit(data_repo)
    rewrite_references_under(data_repo, "old.md", "new.md")
    assert (data_repo / "private.md").read_text() == "[[old.md]] in my notes"
    assert (data_repo / "tracked.md").read_text() == "[[new.md]] in tracked"


def test_preserves_unrelated_wikilinks_byte_identical(data_repo: Path):
    """In a file with both matching and non-matching wikilinks: the
    non-matching ones must be returned BYTE-IDENTICAL — even if their
    form is denormalised. ``[[./other.md]]`` and ``[[also/]]`` would be
    "cleaned up" if we ran normalisation on every wikilink; we don't —
    we only normalise as a side effect of an actual rewrite."""
    original = "see [[old.md]] and [[./unrelated.md]] and [[also/]]"
    (data_repo / "ref.md").write_text(original)
    commit(data_repo)
    rewrite_references_under(data_repo, "old.md", "new.md")
    assert (
        (data_repo / "ref.md").read_text()
        == "see [[new.md]] and [[./unrelated.md]] and [[also/]]"
    )