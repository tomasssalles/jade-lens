# Wikilinks: the path-reference convention

Every reference *from data to a data-repo file* — embedded in markdown prose or
held in a JSON string value — is written as a **wikilink**:

```
[[path]]
```

The path is **relative to the data-repo root**, not to the file containing the
link. (This costs click-navigability in a plain text editor, but the web app's
renderer resolves repo-root paths fine, and the rename-safety win is much larger.)

Source of truth: [jadelens/wikilinks.py](../../jadelens/wikilinks.py) (Python), [web/src/mutation/](../../web/src/mutation/) (JS). The
convention is exercised by the `rename_path` / `delete_path` ops of the
[mutation-pipeline.md](mutation-pipeline.md).

## Why this form

A standard markdown link `[label](path)` has two halves, so rename-safety means
either keeping label and path in lockstep (doubling tokens) or accepting a stale
label. A wikilink has one slot: the same string is both path and display
fallback, a rename rewrites one place, and the bot pays roughly half the output
tokens per reference. The form is borrowed from Obsidian / MediaWiki.

**External URLs are not wikilinks.** `http(s)://…` use normal markdown link or
autolink syntax and are ignored by reference tracking. Wikilinks are reserved for
data-repo paths exclusively.

**Uniformity in JSON.** A reference held in JSON is a wikilink in a value, not a
bare path in a `*Path`-named field — `"notes": "[[projects/leasing/notes.md]]"`,
not `"notesPath": "projects/leasing/notes.md"`. The field name is the bot's
choice; the wikilink form is what makes the reference *detectable*.

## Maintenance is a post-apply pass

All ops in a batch execute in the order the bot emitted them. Wikilink rewriting
(on rename) and reference-existence checks (on delete) happen **once**, at the end
of the batch, against the filesystem state that survived all the ops. This lets
the bot interleave clean-up freely — e.g. `delete_path foo.md` and a
`unified_diff` removing the only `[[foo.md]]`, in either order; the scan only
cares about the end state. A nice side-effect: the bot can't accidentally create a
fresh file that wikilinks to something also deleted in the same batch — the scan
finds the dangling reference and refuses the batch.

**Scope.** The scan covers only **git-visible** files (tracked + untracked but not
gitignored). Gitignored files are the user's private scratch space and out of
scope — rewrites to them couldn't be cleanly reverted on failure anyway
(`git reset --hard` doesn't restore gitignored content).

### Rename (`rename_path`)

1. Each rename applies its own filesystem rename (`git mv`).
2. At batch end, the runtime scans every git-visible file for wikilinks whose path
   is `from` or starts with `from/` (directory case).
3. Each match is rewritten in place — path swapped `from` → `to`. Non-matching
   wikilinks are returned **byte-identical**, even if denormalised (`[[./foo.md]]`,
   `[[foo/]]`, `[[bar/../foo.md]]`); only rewritten links are emitted in clean,
   normalised form.
4. All rewrites + the rename land in one atomic commit.

**The bot does NOT rewrite wikilinks on rename** — the runtime does it, saving the
bot a `unified_diff` per referencing file. The skill is prescriptive about this.

### Delete (`delete_path`)

1. Each delete applies its own `git rm -r`.
2. At batch end, the runtime scans for wikilinks pointing at the deleted path.
   References from files that were themselves deleted in the same batch don't count.
3. If any remain, the batch fails and reports the referencing paths back to the
   bot, which clears them and retries.

**The bot DOES clear wikilinks before/during deletion.** If a reference should
survive as historical prose — *"used to be in `foo.md`, now lives in [[bar.md]]"* —
the bot unlinks it (turns `[[foo.md]]` into plain text) rather than leaving the
wikilink; the post-pass treats any remaining `[[foo.md]]` as a missed cleanup and
fails the batch.

## Display rendering

In raw markdown viewers (and Claude Code's TUI) wikilinks render as literal
`[[path]]` text — recognisable, not clickable. The web app renders the filename
stem as a clickable label that navigates to the linked file in-app (see
[web-app.md](web-app.md)).

## Wikilink integrity enforcement *(planned)*

A planned end-of-apply check will verify that **every wikilink anywhere in the
repo resolves to an existing file**. This generalises the existing
`delete_path` reference check (which only covers files being deleted in the
current batch) into a full integrity scan over the final repo state. Any
dangling wikilink causes the batch to be reverted.

## Sidecar wikilinks

A wikilink pointing into a `.sidecars/` directory is a special restricted case.
Such a wikilink may **only** appear at the exact JSON field that owns the
sidecar (`<stem>.json` at the path corresponding to the sidecar filename). Any
other occurrence — in markdown prose, in other JSON files, or in other fields
of the same JSON — is rejected by the pipeline. See
[inline-sidecar-promotion.md](inline-sidecar-promotion.md).

## Future: JSON value links

A planned extension (not part of the current wikilink implementation) will
allow linking to any JSON value, not just files:

```
[[Projects/Garden.json:comparisons/0/description]]
```

Displayed as e.g. **Projects / Garden [comparisons/0/description]**. Clicking
navigates to the JSON file scrolled to that value; if the value is a sidecar,
it opens the sidecar view instead. This subsumes the sidecar top-bar notation
into a referenceable link format usable uniformly in prose and other JSON
values.

## Forward-compatibility note

The convention was designed for a filesystem, but it survives a future move to a
database substrate cleanly: a wikilink rename-rewrite becomes a single SQL
`UPDATE` across rows rather than a recursive grep + rewrite (see [versioning.md](versioning.md) /
the durable-substrate discussion in [security-and-trust.md](security-and-trust.md)).
