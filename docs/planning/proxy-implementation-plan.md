# Proxy implementation plan

Working plan (disposable). Introduces a **thin secrets proxy** in front of the web
app and migrates all secret-bearing traffic through it. This is the concrete
build-out of the credential decision reached in discussion; it refines the
secret-handling described in `web-app-pivot.md` step 2 (the browser no longer holds
provider keys).

## What & why

The web app is a static SPA that today holds the **GitHub PAT** in the browser and
was about to add a **second browser secret** (the LLM key). Instead, stand up a
**stateless authenticated forwarder** that holds *all* secrets server-side; the
browser keeps only a single **revocable caller token**.

**Shape (decided):**
- **Starlette (Python, ASGI)** on **Google Cloud Run**, **EU region**,
  **scale-to-zero**. A Python ASGI app was chosen over Cloudflare Workers because
  Google STT **streaming** is gRPC-bidi, which Workers can't do; Python is the
  superset (LLM/GitHub over `httpx`, STT streaming over a browser↔proxy WebSocket
  bridged to Google gRPC). **Starlette, not full FastAPI:** a forwarder uses almost
  none of FastAPI's validation/OpenAPI/DI — Starlette gives the same runtime
  (routing, CORS/auth middleware, `StreamingResponse`, WebSockets) with fewer deps
  and a smaller image; add a Pydantic model only in the one or two spots that
  genuinely benefit. (Cold start is masked by the on-focus pre-warm, so this is for
  dependency leanness, not startup speed.)
- **Lean dependency core:** `uvicorn + starlette + httpx`. **No Google LLM SDK** —
  call Gemini's REST/SSE endpoint with `httpx` directly. STT (Phase 5) needs
  `google-cloud-speech`/`grpcio`; lazy-import it (import inside the STT handler).
  Be honest about what that buys: it trims only cold-start **import time** (modest,
  and largely moot given the pre-warm) — the **image still carries grpcio**, so
  image size and install time are unchanged. Truly excluding grpcio from the main
  image would require a **separate STT service**, which is overkill at this scale;
  one image is fine.
- **Stateless forwarder** — no DB, no repo clone. It injects the right secret per
  destination: GitHub PAT → `api.github.com`; LLM key → provider; STT → Google
  (via the Cloud Run **service-account identity**, no key to store).
- **Cold start is masked**: the app's **on-focus GitHub sync** routes through the
  proxy and pre-warms it (non-blocking background refresh, local-first shows cached
  data) before any interactive LLM/STT call. So scale-to-zero gives ~$0 idle with
  the 1–3s cold start invisible in the normal flow.
- **Bot-adapter seam** — provider-agnostic interface; **Gemini first**, swappable.
- **Residual browser secret** = the caller token, sized as *contain + revocable*
  (not eliminate): scoped, rotatable on the proxy in seconds, backed by **provider
  spend caps**. This is why sharing stays hard (below).

Design refs: [security-and-trust.md](../design/security-and-trust.md),
[bot-interaction.md](../design/bot-interaction.md) (adapter/multi-vendor),
[cost.md](../design/cost.md) (usage log), [sync-and-conflicts.md](../design/sync-and-conflicts.md)
(on-focus pull), [web/chat.md](../design/web/chat.md) (stream consumption).

**Repo layout:** the proxy lives in this monorepo under `proxy/` with its own
`Dockerfile`, Cloud Run config, and CI workflow (path-filtered to `proxy/**`). The
web app talks to it via a `VITE_PROXY_URL` setting.

---

## Phases

Each step: implement → test → commit → push to `claude-ai`. GitHub is routed
**first** so we prove the app is unchanged before removing anything.

### Phase 0 — Proxy skeleton + deploy pipeline (de-risk infra first)
- [ ] `proxy/` **Starlette** app: `GET /healthz` only, `Dockerfile`
  (`python-slim`, uvicorn), env config (stdlib, or `pydantic-settings` if the
  validation is worth the dep). Core deps: `uvicorn + starlette + httpx`.
- [ ] **Caller-auth middleware:** require a shared bearer token (`PROXY_TOKEN`) on
  every route except `/healthz`; reject otherwise (anti-open-relay foundation).
- [ ] **CORS:** allow only the app origin(s) (`ALLOWED_ORIGINS` env; the GitHub
  Pages origin + `localhost` for dev).
- [ ] **Secrets:** Google **Secret Manager** for `PROXY_TOKEN` (+ later keys);
  local dev via gitignored `.env`. STT will use the Cloud Run service-account
  identity, not a key.
- [ ] **CI/CD:** GitHub Actions workflow (trigger on `proxy/**`) → lint (`ruff`) +
  type (`mypy`) + `pytest`, then `google-github-actions/deploy-cloudrun` to the EU
  region. Prefer **Workload Identity Federation** over a long-lived SA key in
  Actions secrets.
- [ ] Deploy hello-world to Cloud Run; confirm `/healthz` + auth + CORS end-to-end.
  *This proves the whole pipeline before any real route exists.*

### Phase 1 — GitHub route (the very first route) + prove the app is unchanged
- [ ] `ALL /gh/*` → forward to `https://api.github.com/*` with the **PAT injected**
  server-side. **Scope it:** only the configured data repo
  (`{owner}/{repo}` from env) and the paths the app actually uses (contents, git
  refs/commits/trees/blobs). Reject anything else — the proxy must not be a general
  GitHub relay wielding the PAT.
- [ ] Web app: introduce `VITE_PROXY_URL`; point the GitHub client's base URL at
  `${PROXY_URL}/gh`, drop the `Authorization` header, send the `PROXY_TOKEN`
  instead. **Keep the direct path behind the flag** during migration.
- [ ] **Verify the app basically stays the same:** `web/` `npm test` + `npm run
  build` green (update any tests that asserted the old base URL / auth); manual
  smoke — app loads data and the **on-focus sync** behaves identically through the
  proxy.

### Phase 2 — Remove all GitHub/PAT from the browser
- [ ] Delete the direct-`api.github.com` code path and the flag once Phase 1 is
  proven.
- [ ] Remove **PAT** storage, entry UI, and any references from the app; Settings
  now collects **proxy URL + caller token** only.
- [ ] Web tests updated/green; confirm no secret remains in browser storage except
  the caller token.

### Phase 3 — Docs & README
- [ ] `security-and-trust.md`: document the proxy credential model — all secrets
  server-side, one revocable/scoped browser caller token, anti-open-relay
  (token + repo scoping), spend caps as the residual-risk mitigation, and the
  sharing implication.
- [ ] `README.md`: add a **temporary status** note — the app is currently
  **difficult to share with other users**, because the hardened path requires each
  user to self-host their own proxy (with their own secrets + token); the
  browser-key fallback was deliberately rejected as unfair to non-technical users.
  Point at proxy self-host docs (to be written).
- [ ] Reconcile `web-app-pivot.md` step 2 (secret handling now via proxy). *Left to
  the human — that doc is being actively hand-edited; this plan supersedes its
  "second secret in the browser" framing.*

### Phase 4 — LLM route with streaming (Gemini first) + usage logging
- [ ] Provider-agnostic **adapter interface** (`ChatProvider`); implement **Gemini**
  via **raw `httpx`** against its REST/SSE endpoint (key from Secret Manager) — **no
  Google LLM SDK**. `POST /llm/chat` streams the provider's **SSE** straight back to
  the browser (passthrough; CPU-light, fits Cloud Run/free tiers).
- [ ] Wire the **chat UI** (`web/chat.md`) to consume the stream into bubbles.
- [ ] **Usage logging (shared util):** structured JSON to **Cloud Logging** per
  call — `{ts, route, provider, model, key_id (masked, e.g. ***234), input_chars,
  api_reported_input_tokens, api_reported_output_tokens, latency_ms, status}`.
  Stateless-friendly (no DB); cost reconstructed from logs later (`cost.md`).

### Phase 5 — STT streaming (Google Cloud, WebSocket ↔ gRPC)
- [ ] `WS /stt/stream`: accept mic audio chunks from the browser, bridge to Google
  **`streaming_recognize`** (gRPC bidi) via `google-cloud-speech`, stream **interim
  transcripts** back over the WS. **Lazy-import** the STT module (import inside the
  handler) so `grpcio` loads only when a stream opens — a free micro-optimization on
  cold-start *import time* only; the image still includes grpcio regardless. Auth via the
  **Cloud Run service-account identity** (no key). EU endpoint/region. *(Alternative
  if you'd rather avoid gRPC entirely: a WebSocket-based STT provider such as
  Deepgram, EU region — at the cost of leaving Google.)*
- [ ] Confirm scale-to-zero keeps the instance alive for the duration of an active
  WS/stream; set Cloud Run request timeout to cover the ~5-min window.
- [ ] Mic control in the chat UI; feed final transcript into the input.
- [ ] Extend usage logging (audio seconds, status).

### Phase 6 — Hardening & mitigations
- [ ] **Provider spend caps / budget alerts** (Gemini + Google Cloud) — the cheap
  bound on a leaked caller token.
- [ ] Document **caller-token rotation** (revoke/reissue on the proxy in seconds;
  underlying keys never rotate on a leak).
- [ ] Review GitHub route scoping (repo-locked, method/path allowlist).
- [ ] Error handling / timeouts / graceful upstream-failure surfacing to the UI.
- [ ] Optional: a lightweight keep-alive ping while the tab is focused, if the rare
  mid-session cold start proves annoying.

---

## Open questions
- Exact GitHub path allowlist (minimum set the sync layer needs).
- CI GCP auth: Workload Identity Federation vs. a scoped SA key in Actions secrets.
- Gemini free-tier capability check — is it good enough, or move to paid Claude?
- Whether to give the proxy its own changelog/version track (probably later).
- Self-host-a-proxy docs: how simple can we make it (one-command deploy template)?
