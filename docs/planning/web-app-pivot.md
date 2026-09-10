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

2. **Read-only chat.** Wire the chat to a real LLM API so the bot can **inspect**
   the data and answer questions — no mutations yet. This is the first genuinely
   useful increment and it carries **zero data-risk**, so it's the natural MVP and
   trust-builder.

   **Deliberately kept crude, for speed.** The whole point of the pivot is a useful
   bot *soon* — enough value to stay motivated to build the rest — so steps 2–3 skip
   the substantial machinery originally scoped here:
   - **No discovery flow, no context optimization.** Send the **entire data repo**
     in the context every turn — no index/always-load/per-turn selection, no
     KV-cache optimization. The data repo is still tiny; the deterministic
     context-assembly / structured data-request flow in
     [bot-interaction.md](../design/bot-interaction.md) is a later improvement.
   - **Minimal cost visibility.** No per-model pricing math yet — just **log each
     API call** with whatever facts we have (e.g. "sent N characters to Gemini Flash
     2.5 with key ***234; the API reported M input tokens"). Stats and cost
     estimates get reconstructed from that log later. See [cost.md](../design/cost.md).
   - **API-key storage + trust — the one thing that stays real.** The browser now
     holds a **second secret** (the LLM key) alongside the GitHub PAT; this one
     isn't deferrable. See [security-and-trust.md](../design/security-and-trust.md)
     and the *Credential storage and trust* backlog item.

   **Which vendor first — likely Gemini, not Claude.** Originally Claude-first, now
   reversed: Claude is already reachable in Claude Code under my Pro subscription
   (with great built-in discoverability), whereas Gemini has a usable **free API
   tier** and Claude does not — so we'll probably start on Gemini's free tier. Open
   risk: whether the free-tier models are capable enough to organize and reason about
   the data; if not, I switch to the paid Claude API and start paying. Either way,
   build behind the **bot-adapter seam** so the vendor stays swappable (see
   [bot-interaction.md](../design/bot-interaction.md), multi-vendor).

3. **Full agentic loop (bot writes data).** The bot proposes and applies changes
   through the **same** mutation pipeline as UI edits — byte-identical,
   conformance-pinned. See [mutation-pipeline.md](../design/mutation-pipeline.md).
   *Safety floor — not a concern.* Even with the in-app manual-editing UI unbuilt, I
   can always edit the data directly in a **local clone** of the repo (commit +
   push); sync pulls it in as ground truth on the bot's next turn — a manual clone
   edit is just a remote commit, fast-forwarded with no bot involvement (see
   [sync-and-conflicts.md](../design/sync-and-conflicts.md); it bypasses the
   validation pipeline, so `jadelens check` re-validates if needed). That's the
   fallback while the in-app correction UI is unbuilt, so there's no rush to build
   it. Audit log + git history + forward-only correction ("undo that / change it
   back") still apply on top.

4. **Speech-to-text — browser built-in.** Mic input via the Web Speech API, no STT
   service we integrate. Lowest-friction capture; directly targets the
   capture-friction pain. *Independent of the bot loop — parallelizable with 1–3.*
   *Caveat, possibly disqualifying:* Chrome's Web Speech recognition routes audio
   through Google's servers with **no control over where** — from Germany that
   likely means a US round-trip, bad on both **privacy** (data leaves the EU) and
   **latency**. We'll test it when we get there and may have to jump to step 5 almost
   immediately.

5. **External STT.** A more controllable/consistent engine behind a setting — start
   with Google Cloud Speech-to-Text, whose free tier is reasonable and which offers
   **EU data residency**, directly addressing the step-4 privacy/latency problem.
   Originally framed as an *optional* upgrade for quality beyond the built-in; per
   step 4 it may instead become the **primary** STT path.

---

## Assessment / considerations

- **Sound pivot.** It aims straight at the felt pain: the conversational assistant
  is the "north star" that dissolves most of the usability themes, so pulling it
  forward is the right call over finishing manual-editing plumbing first.
- **The read → write → voice ordering is well de-risked.** Step 2 delivers value
  with no mutation risk and proves the API + context-assembly path before step 3
  ever touches data. Mirrors how the app itself grew (read-only viewer first).
- **Only one under-stated dependency survives the crude-first choice: API-key
  trust.** Context assembly and cost tracking were originally scoped as *substance*,
  but the pivot deliberately reduces both to the crudest thing that works
  (whole-repo context; a plain API-usage log), banking on the tiny data repo.
  Storing a second secret in the browser is the one thing that can't be shortcut —
  the biggest new risk surface.
- **Bot-writes front-run the in-app correction UI — accepted, and unproblematic.**
  The fallback is editing the local clone directly (commit + push; sync makes it
  ground truth), backed by audit log + git history + forward-only correction. So
  there's no urgency to build an in-app manual-correction path.
- **STT is an independent track** (steps 4–5) and can run in parallel with 1–3. Note
  step 5 may not be optional: if the built-in (step 4) proves privacy/latency-bad
  from the EU, it becomes the real STT path.
