# Documentation

This README describes how JADE LENS documentation is organized and how to maintain it.

---

## Overview of documentation outside this directory

**`README.md`** (repo root) — user-facing. Describes what JADE LENS is, how to install and get started, and basic usage. Contains one short section directing developers to this `docs/` directory. Should be accessible to non-technical users.

**`CLAUDE.md`** (repo root) — context for the development assistant (Claude Code). Inlines a concise description of: what the project is, how the source files are organized, and how the documentation is organized. This gives the bot enough orientation to start working without requiring it to read additional files first. Details on specific subsystems live in the design docs — the bot reads those when working on relevant code.

---

## docs/ directory structure

```
docs/
  README.md              ← you are here
  design/                ← conceptual design documents (permanent)
  changelogs/            ← version-keyed changelogs
    cli/
    web/
    data-format/
  planning/              ← backlogs, known issues, implementation plans (disposable)
```

---

## design/

Conceptual design documents describing how different parts of the project work, why they work that way, and what alternatives were considered and rejected.

Design documents are the **permanent record**. They describe intended behavior, architectural decisions, data formats, interaction models, and conventions. They are not constrained to what has been built — they can describe future phases and the big picture. They are also not limited to the idealized final state — they can describe progressions ("built like so in phase 1, then expanded like so in phase 2").

Design documents should include:

- The chosen approach and how it works.
- Alternatives that were considered.
- The rationale for the decision — why this approach over the others.

Files in `design/` can be organized flat (if filenames are descriptive enough) or with one level of subdirectories for broad groupings (e.g. `design/ui/`, `design/data/`, `design/infrastructure/`). Avoid deeper nesting. Some documents will cross category boundaries — that's fine, just pick the best fit and keep a flat structure if categorization feels forced.

**Design documents are never deleted.** They are updated when decisions change, and they evolve as the project evolves.

---

## changelogs/

Version-keyed changelogs for each independently versioned component. See the versioning design document in `design/` for the full versioning strategy.

```
changelogs/
  cli/              ← Python tooling and Claude Code skill
    unreleased.md
    v0.1.0.md
    v0.2.0.md
    ...
  web/              ← web application
    unreleased.md
    v0.1.0.md
    ...
  data-format/      ← data format (sequential integer versions)
    unreleased.md
    v1.md
    v2.md
    ...
```

Each component directory always contains an `unreleased.md` file where changes are collected incrementally as work is done. When a version is finalized:

1. `unreleased.md` is renamed to the version identifier (e.g. `v0.2.0.md` for semver components, `v3.md` for data format).
2. A git tag is pushed (`py-v0.2.0`, `web-v0.2.0`, etc. — no tags for data format versions).
3. A new empty `unreleased.md` is created.

Changelog entries should be concise and human-readable. Web changelogs may be very brief for patch releases (a single line is fine). Data format changelogs should describe what changed in the format and what the migration does — they double as migration documentation.

---

## planning/

Backlogs, known issues, and implementation plans. **Everything in this directory is disposable.** When work is completed, entries are deleted. This is the key distinction from `design/` — planning documents have no permanent value.

### Core files

- **`backlog.md`** (one per major component, or a single shared one — whichever fits better as the project evolves): tasks to be done, roughly prioritized. Entries are removed when completed.
- **`known_issues.md`**: known issues with no current plans to fix. These are indefinitely deferred, not forgotten. Entries are removed when fixed or when a decision is made that they won't be fixed.

### Implementation plans

For tasks that need more than a backlog line, an implementation plan can be created as a separate file in `planning/`. These can go to any depth of technical detail, including code snippets, pseudocode, API sketches, and step-by-step instructions.

Not every task needs an implementation plan. Create one when the task is complex enough that thinking it through in writing will save time during implementation, or when the plan needs to be handed off to another session or another developer.

### Deletion protocol

When a task is completed and its planning documents are being cleaned up:

1. **Before deleting**, check whether any conceptual content should be captured in `design/`. If the implementation plan contains design decisions, rationale, or architectural descriptions that aren't already documented, update or create the relevant design document.
2. **Before deleting**, check whether the change should be noted in `changelogs/`. Add an entry to the relevant `unreleased.md` if not already present.
3. Delete the planning entries (backlog line, implementation plan file, known issue entry — whichever apply).

The design documents and changelogs are the permanent record. Planning documents are working material that feeds into them.

---

## Maintaining this documentation

### Adding a new design document

Create a file in `design/`, optionally in a subdirectory if there's a natural grouping. Use a descriptive filename (e.g. `json-card-viewer.md`, `sync-and-conflicts.md`). No required template — write what's needed to capture the design and its rationale.

### Adding an implementation plan

Create a file in `planning/`. Name it after the task or feature (e.g. `planning/calendar-view-implementation.md`). Link to it from the relevant backlog entry if one exists. Delete it when the work is done (after following the deletion protocol above).

### Updating design documents

Design documents should be updated when decisions change, not appended to indefinitely. If a decision is reversed or refined, update the document to reflect the current state. Use version control history to see what changed and when — the document itself should read as "this is how things work now," not as a chronological log of decisions.

When a document grows too large or covers too many topics, split it. Prefer several focused documents over one sprawling one.

### Cross-references

Documents may reference other documents. Use relative markdown links (e.g. `[card viewer design](design/json-card-viewer.md)`). Keep references minimal — if two documents are tightly coupled, consider merging them.
