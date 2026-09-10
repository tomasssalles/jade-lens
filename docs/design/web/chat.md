# Chat UI (web app)

The in-app conversational surface for talking to the assistant. Built as **step 1**
of the web-app pivot (`../../planning/web-app-pivot.md`); the LLM wiring, agentic
loop, and STT are later steps. **Mobile-first** — desktop browser is easier and is
designed separately, later.

Related: [web-app.md](web-app.md) (parent), [markdown-rendering.md](markdown-rendering.md)
(reused for message rendering), [json-viewer.md](json-viewer.md) (reused by the
future inline-data cards).

---

## Layout & interaction

Familiar messenger layout:

- **Input pinned to the bottom**, message **bubbles** above, scrollable back to the
  start of visible history.
- The input **rises above the on-screen keyboard**. Implement via the
  **`visualViewport` API** (react to `visualViewport.resize`/`scroll`), *not* CSS
  `env(keyboard-inset-*)` — the latter is inconsistent across mobile browsers.
- **User vs. bot bubbles on opposite sides**, distinct colors drawn from the
  **settings theme tokens** so chat matches the other views (light and dark).
- Auto-scroll to the newest message on send/receipt, but **don't force-scroll** the
  user down while they've scrolled up reading history.

## Message content

- **Both user and bot messages render as markdown**, reusing the app's existing
  markdown rendering ([markdown-rendering.md](markdown-rendering.md)) — lists,
  tables, highlighted/clickable URLs, code, out of the box.
- **User** messages use a **restricted** markdown config: no raw HTML, and neutralize
  STT-prone artifacts (a stray leading `#` becoming a heading, unbalanced `*`/`_`).
  STT produces prose, not syntax, so this only guards the ugly edge cases.
- **v1 scope: plain text + markdown only.** Nothing richer (see *Future*).

## One continuous conversation — no thread list

- **No list-of-conversations UI.** A single, infinite, scrollable stream of bubbles.
- Display history **persists across reloads** (durable scrollback). *[Store TBD —
  IndexedDB alongside the existing local state.]*

## Context boundary — the in-app "/clear"

The user can reset what's sent to the model **without hiding the transcript**.

- Prior bubbles **stay visible** in the scroll; they are **excluded from the context**
  sent on subsequent turns. A **visible marker** shows where the cut happened.
- Two distinct notions of history, which must stay separate:
  - **Display history** — every bubble ever, always in scrollback.
  - **Context history** — only bubbles *after* the most recent boundary; this is what
    is sent to the LLM.
- **The data context is unaffected by a cut.** The whole data repo is re-sent every
  turn regardless (the pivot's crude-context decision), so after a cut the bot still
  sees all the data — it only forgets the prior *conversation*.
- This is deliberately **more transparent than the CLI `/clear`**: the boundary is
  explicit and visible, directly answering the "I can't see or control what's in
  context" concern.

**v1 defaults (proposed):**
- Each cut leaves a **persistent marker** in scrollback (a subtle full-width divider,
  small label — e.g. "Context cleared" + timestamp). Multiple cuts over time each
  leave their marker, but only the **latest** governs what's sent.
- The marker appears at the current bottom; the user keeps typing below it.
- Not undoable in v1 (non-destructive — the bubbles remain). Re-including cut-off
  history is a possible future affordance since the bubbles still exist.
- **Open:** placement of the cut control (no header chrome yet — likely a small icon
  near the input or an overflow menu).

## Future (noted, not v1)

- **Inline data in the chat.** The data a message is *about* — or that the bot just
  changed (step 3) — rendered as a **compact card within the stream** (reusing
  `JsonCardViewer` + the sidecar preview-truncation / ↗-expand pattern), so the user
  watches data change inline during the conversation. Strong feature; deferred.
- **Viewing data while chatting** is served by **swapping** surfaces (a pull-up
  drawer vs. a tab/screen toggle — TBD), never a permanent split — simultaneous
  data+chat+keyboard is explicitly rejected for mobile.
- **Tool-call / diff rendering** (agentic loop, step 3) and a **mic control** (STT,
  step 4): leave layout room for both so they don't force a rework.
