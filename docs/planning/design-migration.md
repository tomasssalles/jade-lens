# Design-docs migration plan

Migrating the monolithic `legacy-docs/DESIGN.md` (1146 lines, 18 sections — a
vision doc) into the new `docs/design/` structure (see `docs/README.md`): one
high-level overview plus several narrower, deeper docs, linked together. **No
bijection** with the old sections — we translate content, splitting and merging
as makes sense, and **verify validity against the code as we go** (DESIGN
describes intended design; some of it is built, some is still planned, and a few
things have actually diverged). When unsure whether something still reflects
reality/intent, ask Tomás.

This is a multi-session task. Keep this checklist current and commit per doc.

## Target structure (`docs/design/`)

Each entry: the doc, its scope, the DESIGN sections it draws from, and other
legacy inputs to reconcile.

- **`jadelens.md`** — overview: purpose & behaviour, constraints, architecture,
  guiding principles, and the map/links to every other design doc. (§1, §2, §3,
  §17; pointers to roadmap/scope.)
- **`data-model.md`** — file types, the index file (`Index.json`), preferences,
  schemas & the view registry, the database option. (§4.1, §4.6, §4.7, §4.8,
  §4.9)
- **`mutation-pipeline.md`** — the five-op change format, validation /
  verification / atomicity, the shared (web + CLI) pipeline, cross-client
  byte-identity & the conformance suite, the mutation-tool wire format. (§4.2,
  parts of §12.1–§12.2) Reconcile: `legacy-docs/docs/mutation-sync-implementation-plan.md`.
- **`wikilinks.md`** — `[[path]]` reference convention; rename/delete mechanics;
  the post-apply pass. (§4.3)
- **`inline-sidecar-promotion.md`** — promotion rule + hysteresis + sidecar
  filenames. (§4.4, §4.5) ⚠ still a backlog item, not built — mark as planned.
- **`bot-interaction.md`** — the bot's role, the discovery flow, prompt-cache
  structure, sessions, and multi-vendor support (folded in). (§5, §6, §11)
- **`audit-and-correction.md`** — atomic-change unit, the operations log, commit
  messages, forward-only correction. (§7)
- **`sync-and-conflicts.md`** — local-first sync, triggers, substrate, conflict
  resolution / stash. (§8) Reconcile: `legacy-docs/docs/sync-and-conflicts.md`
  (detailed mechanism doc — likely the real source of truth here).
- **`web-app.md`** — UI principles, UI-edits-feed-the-pipeline, navigation,
  default vs. promoted views, value editors, assistant name. (§9) Reconcile:
  `legacy-docs/web/README.md`, `legacy-docs/docs/web/`.
- **`calendar.md`** — external calendar as an augmentation/lazy-JSON source;
  phasing. (§10)
- **`claude-code-integration.md`** — the skill, the mutation tool, output
  capabilities, installation/bootstrap (incl. the new `jadelens init`). (§12)
  Reconcile: `legacy-docs/docs/data-repo-setup.md`.
- **`cost.md`** — cost ledger, thresholds, token-cost as a design metric. (§13)
- **`versioning.md`** — three version tracks + migration. (§14) Mostly a move of
  `legacy-docs/docs/versioning.md`.
- **`security-and-trust.md`** — cross-origin exposure, PAT storage, hosting,
  encryption, auth. (§16)

§15 (v1 scope / future work) and §18 (open questions) are **distributed**: future-
work items become "Future" sections in the relevant design doc; live open
questions move to `docs/planning/` (backlog/known-issues) or the relevant doc.

## Conventions for this migration

- Each design doc roughly **links its most relevant source files** (per
  `docs/README.md`), so the chain request → backlog → design → code holds.
- Cross-link between design docs with relative links instead of the old `§N`
  references. (Old `§N` references in code comments / backlog can be updated
  opportunistically later — out of scope here.)
- Mark clearly what is **built** vs. **intended/planned** so the docs stop
  reading as if everything exists.

## Validity findings (apply while writing the relevant doc)

Confident divergences from DESIGN (code has moved on):
- Mutation tool is **`jadelens apply <data-repo>`** (was `jadelens-apply`).
- Skill render is **`jadelens render <data-repo>`** (was `render-skill`).
- New **`jadelens init <data-repo>`** command: clones an empty data repo,
  scaffolds the bootstrap files (incl. a `CLAUDE.md` for the data-repo bot),
  renders+symlinks the skill, commits & pushes. DESIGN predates it.
- Stash CLI is **`jadelens stash <repo> --list | --resolve <id>`**.
- Operations-log line is **compact JS-canonical** (`JSON.stringify(obj)` form:
  no spaces, `ensure_ascii=False`, integer-valued-float→int), not the
  spaced/escaped form shown in §7.2.

Needs verification against code / ask Tomás:
- **§4.4 inline-sidecar promotion** — DESIGN describes it as live runtime
  behaviour, but it's an open backlog item. Confirm it is NOT built; document as
  planned.
- **§9 UI** — which parts are real (card viewer, edit-mode lock, micro-edits for
  bool/number/date/wikilink exist) vs. planned (promoted views, navigation by
  index, search).
- **§16.2** — v0.1.0 plaintext-PAT stance: confirm the exact current storage
  (IndexedDB) and the warning text actually shown.

## Checklist

- [x] Read DESIGN.md end to end; draft target structure + this plan.
- [x] `jadelens.md` (overview) + doc-map.
- [x] `data-model.md`
- [x] `mutation-pipeline.md`
- [x] `wikilinks.md`
- [x] `inline-sidecar-promotion.md` — **confirmed NOT built**; documented as planned. Also removed the promotion guidance from the skill template (it shouldn't describe an unbuilt feature).
- [x] `bot-interaction.md`
- [x] `audit-and-correction.md`
- [ ] `sync-and-conflicts.md` (reconcile legacy mechanism doc)
- [ ] `web-app.md` (reconcile legacy web README + verify built vs. planned)
- [ ] `calendar.md`
- [ ] `claude-code-integration.md` (incl. `jadelens init`)
- [ ] `cost.md`
- [ ] `versioning.md` (migrate legacy versioning.md)
- [ ] `security-and-trust.md`
- [ ] Distribute §15 future-work + §18 open questions.
- [ ] Migrate the remaining `legacy-docs/docs/*` mechanism docs into `design/`.
- [ ] Cross-link pass: every design doc links its key source files + siblings.
- [ ] Second pass on root `CLAUDE.md` to name the real `docs/` files.
- [ ] Delete `legacy-docs/`; fast-forward `main`.
