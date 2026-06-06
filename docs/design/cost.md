# Cost transparency and efficiency

*(Intended design — the cost ledger is part of the web-app bot path and is not yet
built. Token-cost as a design metric, below, already shapes choices that are
built.)*

Constraint 2 ([jadelens.md](jadelens.md)) is "near-zero recurring AI cost". Two
things serve it: a **cost ledger** that makes spend visible and capped, and
**token-cost as a design metric** that's baked into format and flow choices.

Related: [bot-interaction.md](bot-interaction.md) (the model/vendor switching the
ledger backs), [mutation-pipeline.md](mutation-pipeline.md) (the compact patch
formats), [web-app.md](web-app.md) (where totals surface).

## Cost ledger

Every API call's usage is recorded locally from the response metadata — no
client-side tokenizer, no pre-call estimation. The ledger keys on the **API key
used** (not just vendor + model), since the user may hold multiple keys against
one vendor.

- **Paid keys:** cumulative spend per period (day / week / month).
- **Free-tier keys:** whether the daily quota is hit.

Different semantics; both visible.

## Thresholds

Two configurable thresholds per key:

- **Warning threshold** — the UI surfaces a warning when crossed.
- **Hard cap** — the bot refuses further calls on that key until the period rolls
  over or the user picks another key.

Overshoot of one in-flight call is acceptable (a few-dollars-worst-case overrun).

## Summary views

Daily, weekly, and monthly cost summaries in the UI, per key and aggregate.

## Rate model

The running estimate uses **non-cached rates** — pessimistic, so actual spend is
at or below the displayed number. Cache-discount modelling is deferred; the
pessimistic bias errs toward caution, the right direction.

## Token-cost as a design metric

Output-token frugality drives choices throughout the design — several already
built:

- **Compact patch formats** — JSON Patch, unified diff with 0 context lines
  ([mutation-pipeline.md](mutation-pipeline.md)).
- **Programmatic inline-vs-sidecar promotion** so the bot doesn't emit two-op
  writes ([inline-sidecar-promotion.md](inline-sidecar-promotion.md) — planned).
- **Cache-friendly index structure** — no fields that mutate on every write
  ([data-model.md](data-model.md)).
- **Eager-load-everything** as the v1 discovery flow, keeping per-query rounds at
  one ([bot-interaction.md](bot-interaction.md)).
- **Model-right-sizing per chat, not per turn.** Pick the model when a chat starts
  and stick with it — the prompt cache is keyed by `(model, prefix)`, so switching
  mid-chat invalidates the cache the previous model built. Haiku-class for routine
  quick chats; reach for Sonnet when the chat needs heavier reasoning. Mid-chat
  escalation is allowed when genuinely necessary but pays a cache-cold-start cost
  — avoid as a default ([bot-interaction.md](bot-interaction.md)).
