# Bot interaction

How the bot fits in: what it does, how it gets the data it needs (the discovery
flow), and the wish to keep the bot vendor swappable. The `/jade` path is built
and uses Claude Code's own agentic navigation; the **web app's** bot path — the
discovery flow and prompt-cache engineering below — is **intended design, not yet
built**.

Related: [mutation-pipeline.md](mutation-pipeline.md) (how the bot writes), [data-model.md](data-model.md) (the index it
navigates by), [claude-code-integration.md](claude-code-integration.md) (the `/jade` path), [cost.md](cost.md) (the
ledger behind vendor switching).

## What the bot does

- **Interpret** the user's chaotic natural-language input.
- **Decide** what files, schemas, and structures should exist to hold it.
- **Write** changes via the five-op mutation set ([mutation-pipeline.md](mutation-pipeline.md)) — never
  raw file-edit primitives.
- **Answer** queries, apply natural-language filters, produce statistics.
- **Maintain the index** ([data-model.md](data-model.md)) so future interactions navigate
  efficiently, including `alwaysLoad` markings for context-essential data.

The **primary input surface** is a prominent, always-visible chat input in the UI;
single-shot prompts work for quick actions, and the input can expand into a
multi-turn conversation that settles into a data change only after several rounds
(or ends with none). Manual UI editing is the fallback and the convenience path
for trivial operations — see [web-app.md](web-app.md).

## Discovery flow *(web-app bot — intended, not built)*

When a query arrives, the runtime can't programmatically know which files the bot
needs; some discovery is required. The design minimises round-trips and maximises
prompt-cache reuse.

### Sessions and prompt-cache structure

**Sessions are chat threads** — usually short (often one input + one response), a
new chat per "thing I want to tell or ask." Chat history is kept in memory for the
chat's life; chat content is not persisted to the data repo. A single user-facing
turn can be **multiple API rounds** the runtime handles transparently (e.g. round
1 returns a structured data request, round 2 returns the answer with the loaded
data); only resulting data changes hit the operations log, and the UI shows one
turn.

Each prompt is layered for caching:

```
[ system prompt ]                       ← chat-independent, rarely changes
[ index ]                                ← chat-independent, changes occasionally
[ alwaysLoad files + their sidecars ]    ← chat-independent, changes occasionally
═══ cache breakpoint (chat-independent) ═══
[ this chat's history so far ]          ← chat-specific, grows within the chat
═══ cache breakpoint (chat-specific) ═══
[ this turn's discovery-loaded data ]   ← turn-specific
[ user query for this turn ]            ← turn-specific
```

The chat-independent prefix (system + index + alwaysLoad) is identical across
chats, so a fresh chat within the provider's cache TTL gets a hit on the bulk of
the prefix for free — caching is not session-bounded. It's invalidated only by
index changes or alwaysLoad-content changes. The chat-specific cache is
invalidated by switching chats; new turns *extend* it rather than break it.

Anthropic's standard cache TTL is 5 minutes (a 1-hour option exists at ~4× cost,
interesting for sparse usage — not adopted by default). **Cache is keyed by
(model, prefix)**, so switching models mid-chat starts cold — which shapes
model-right-sizing ([cost.md](cost.md)).

### What gets loaded

- **Sidecars load eagerly** with their parent JSON: cost is bounded by the
  parent's own references, the bundle caches well, and it avoids "oh, I also needed
  the notes" follow-ups. Escape hatch: `lazyLoadSidecars` in the index.
- **JSON-file selection — three candidate patterns:**

  | Pattern | Rounds | Notes |
  |---|---|---|
  | **Eager-load-everything** | 1 | Simple, cache-friendly; doesn't scale past modest volumes |
  | **Structured data-request round** | 2 (sometimes 1) | Round 1 lists needed files; round 2 answers. Cache keeps round 2 cheap. Vendor-portable. |
  | **Tool-use-driven** (`read_file`) | Variable | All vendors support function-calling but wire formats differ; risks iterative discovery |

  **v1 direction: eager-load-everything**, assuming modest early volumes; graduate
  to structured-data-request when data grows (rough heuristic: a few hundred KB of
  JSON). Tool-use stays a later option.

- **Cross-chat history** (re-loading prior threads for a multi-day conversation) is
  **deferred**. Each new chat starts with empty history; the chat-independent
  prefix is still shared and cache-friendly.

## Multi-vendor support *(design wish, not strict; not built)*

The user wants the *option* to swap between Anthropic, Gemini, and OpenAI without
a major refactor. It's a wish, not a hard requirement — if other concerns
dominate, staying Anthropic-only is fine.

- **Bot adapter layer** — a clean seam: JADE LENS speaks "prompt + tool specs →
  text and/or structured calls"; adapters translate to vendor APIs. Doesn't need
  to be fully provider-agnostic on day one — just a contained boundary.
- **Portable output formats** preserve optionality cheaply: **unified diff** for
  markdown (over Claude-specific search/replace blocks); **JSON tool descriptions
  in the prompt** (over MCP, which still needs per-vendor wire adapters).
- **Manual switching with cost visibility** — **no automatic failover** (at least
  early): the user wants to know which model is responding and learn each model's
  failure modes. A settings panel lists configured keys (vendor + model +
  paid/free) with per-key spend / quota; when a key's threshold is crossed the bot
  refuses and the user picks another. See [cost.md](cost.md).

The `/jade` path is Claude-only by definition (it *is* Claude Code); multi-vendor
applies to the web app's bot path.
