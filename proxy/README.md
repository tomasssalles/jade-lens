# JADE LENS secrets proxy

Stateless authenticated forwarder that holds all server-side secrets (GitHub
PAT, LLM key, STT auth) so the browser holds only a single revocable caller
token. Runtime: **Starlette** on **Cloud Run** (EU, scale-to-zero).

Plan & rationale: `../docs/planning/proxy-implementation-plan.md`.

**Built so far:** `GET /healthz`, caller-auth on every other route, CORS locked
to the app origin(s), and `/gh/{path}` — a forwarder to api.github.com with the
PAT injected, scoped to the single configured `DATA_REPO`. LLM/STT come later.

## Local dev

```sh
cd proxy
cp .env.example .env          # edit values
uv sync --dev
set -a && . ./.env && set +a  # source secrets into the shell
uv run uvicorn app.main:app --reload
```

Checks: `uv run ruff check .` · `uv run mypy app` · `uv run pytest`.

## Config (env)

| Var | Meaning |
|---|---|
| `PROXY_TOKEN` | Shared bearer token the web app must send (`Authorization: Bearer …` or `X-Proxy-Token`). Auth fails closed if unset. |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed by CORS. |
| `GITHUB_PAT` | PAT injected on `/gh` forwards. Never sent to the browser. |
| `DATA_REPO` | `owner/repo` the `/gh` route is scoped to. |
| `PORT` | Set by Cloud Run (default 8080). |

## Deploy (Cloud Run)

CI (`.github/workflows/proxy-deploy.yml`) lints/types/tests on every change under
`proxy/**`, and deploys from `main` **once GCP is configured**. Required repo
**Variables**: `GCP_PROJECT`, `GCP_REGION` (an EU region, e.g. `europe-west1`),
`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA` (Workload Identity Federation — no long-lived
key in CI). Until these are set the deploy job is skipped.

Secrets are **not** injected by CI — set them on the Cloud Run service via Secret
Manager:

```sh
gcloud run services update jadelens-proxy --region <REGION> \
  --update-secrets PROXY_TOKEN=proxy-token:latest \
  --set-env-vars ALLOWED_ORIGINS=https://<user>.github.io
```

Later phases add `GITHUB_PAT`, the LLM key, and STT auth (STT via the service
account identity, no key).
