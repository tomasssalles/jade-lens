# Web-app pivot: make it daily-usable

Working plan (disposable). Re-sequences the roadmap to make the web app genuinely
usable day-to-day **before** finishing the originally-planned components.

**Why now.** Real usage surfaced the app's core pains — stale content, the friction
of high-frequency capture, and the burden of talking through a heavyweight pipeline
to store anything. All of these are most relieved by an ambient, conversational
assistant living *inside the app itself* — which was previously scheduled as the
**last** phase (the "Bot in the web app" backlog item). This pivot pulls it forward.

After the steps below the app is "really usable"; we then resume the
originally-planned components (the manual editing suite, schema/view registry,
calendar, …) — see `backlog.md`.

---

## Steps

1. **Chat UI in the web app.** The conversational surface — message list, input,
   streaming, session history. Visual design still open. Design it with steps 2–5
   in mind: leave room for tool-call / diff rendering (step 3) and a mic control
   (step 4), so the UI doesn't need rework as those land.
   *Hard dependencies:* none.

2. **Read-only chat with Claude.** Wire the chat to the real Claude API so the bot
   can **inspect** the data and answer questions — no mutations yet. This is the
   first genuinely useful increment and it carries **zero data-risk**, so it's the
   natural MVP and trust-builder. Three things it *really* depends on (substance,
   not add-ons):
   - **Context assembly / discovery flow** — the web app builds prompts
     deterministically (index + always-load + history + per-turn data), unlike
     Claude Code's agentic navigation. See [bot-interaction.md](../design/bot-interaction.md).
     Start simple (eager-load what fits) and iterate toward the structured
     data-request flow.
   - **API-key storage + trust** — the browser now holds a **second secret** (the
     Anthropic key) alongside the GitHub PAT. See
     [security-and-trust.md](../design/security-and-trust.md) and the
     *Credential storage and trust* backlog item.
   - **Cost visibility** — no Pro-subscription umbrella here; every call costs
     money. At minimum, basic per-session cost surfacing. See
     [cost.md](../design/cost.md).

   Build it behind the **bot-adapter seam** — a Claude-only implementation, but the
   interface stays vendor-neutral so Gemini / open-weights can slot in later
   (see [bot-interaction.md](../design/bot-interaction.md), multi-vendor).

3. **Full agentic loop (bot writes data).** The bot proposes and applies changes
   through the **same** mutation pipeline as UI edits — byte-identical,
   conformance-pinned. See [mutation-pipeline.md](../design/mutation-pipeline.md).
   *Safety-floor note:* the bot can now change data while the manual-editing UI is
   still unbuilt, so the "the UI is the floor when the bot is wrong" guarantee is
   thin in the interim. Lean on the audit log + git history + forward-only
   correction ("undo that / change it back"), and keep a minimal manual
   review-and-correct path on the near horizon.

4. **Speech-to-text — browser built-in.** Mic input via the Web Speech API, no STT
   service we integrate. Lowest-friction capture; directly targets the
   capture-friction pain. *Caveat:* Chrome's Web Speech recognition typically routes
   audio through Google's servers under the hood — it's "no service *we* run," not
   necessarily on-device; note that where privacy matters. *Independent of the bot
   loop — parallelizable with 1–3.*

5. **Optional external STT.** A more controllable/consistent engine behind a setting
   (start with Google Cloud Speech-to-Text), for quality beyond the built-in.

---

## Assessment / considerations

- **Sound pivot.** It aims straight at the felt pain: the conversational assistant
  is the "north star" that dissolves most of the usability themes, so pulling it
  forward is the right call over finishing manual-editing plumbing first.
- **The read → write → voice ordering is well de-risked.** Step 2 delivers value
  with no mutation risk and proves the API + context-assembly path before step 3
  ever touches data. Mirrors how the app itself grew (read-only viewer first).
- **Steps 2–3 have three under-stated dependencies** — context assembly, API-key
  trust, and cost tracking — that are the *substance* of the work, not optional
  extras. They're called out per-step above so they're scoped in rather than
  discovered mid-build. The API-key + cost surfaces are the biggest new risk.
- **Bot-writes front-run the manual-correction floor.** An accepted trade, covered
  in the interim by audit/history/forward-correction — but worth a conscious
  minimal-correction path so the user is never stuck with a bot mistake and no
  manual recourse.
- **STT is an independent track** (steps 4–5) and can run in parallel with 1–3.
