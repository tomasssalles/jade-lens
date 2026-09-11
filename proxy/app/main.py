"""JADE LENS secrets proxy.

A stateless authenticated forwarder. The browser holds only the caller token;
the real secrets (GitHub PAT, later LLM/STT) live here and are injected per
destination.

Routes:
- ``GET /healthz`` — public health check.
- ``/gh/{rest:path}`` — forward to api.github.com with the PAT injected, scoped
  to the single configured data repo (Phase 1).
"""

from __future__ import annotations

import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp

from app.config import Settings

# Routes reachable without the caller token. /healthz must stay open so the
# platform's health checks (and a cheap keep-warm ping) work.
PUBLIC_PATHS = frozenset({"/healthz"})

GITHUB_API = "https://api.github.com"
# Methods the web app actually uses against GitHub (read + Git Data write path).
GH_ALLOWED_METHODS = frozenset({"GET", "POST", "PATCH"})
# Response headers worth passing back to the browser; everything else (auth,
# CORS, transfer-encoding, rate-limit internals) is dropped.
GH_PASSTHROUGH_RESPONSE_HEADERS = ("content-type", "etag", "link")


def _extract_token(request: Request) -> str | None:
    """Bearer token from `Authorization`, or the `X-Proxy-Token` fallback."""
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    xtoken = request.headers.get("x-proxy-token")
    return xtoken.strip() if xtoken else None


class CallerAuthMiddleware(BaseHTTPMiddleware):
    """Reject any non-public request lacking the shared caller token.

    This is the anti-open-relay guard: without it, anyone who found the proxy
    URL could spend the injected secrets. CORS preflight (OPTIONS) is handled by
    the outer CORS middleware and never reaches here.
    """

    def __init__(self, app: ASGIApp, *, token: str) -> None:
        super().__init__(app)
        self._token = token

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)
        provided = _extract_token(request)
        # Constant-time compare; also fail closed if the token isn't configured.
        if (
            not self._token
            or provided is None
            or not hmac.compare_digest(provided, self._token)
        ):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


async def healthz(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def _gh_path_in_scope(rest: str, data_repo: str) -> bool:
    """True if the GitHub path targets only the configured `owner/repo`.

    Confines the PAT to one repo — the proxy is not a general GitHub relay.
    """
    prefix = f"repos/{data_repo}"
    return rest == prefix or rest.startswith(prefix + "/")


async def gh_proxy(request: Request) -> Response:
    """Forward a scoped GitHub API call with the server-side PAT injected."""
    settings: Settings = request.app.state.settings
    if not settings.github_pat or not settings.data_repo:
        return JSONResponse({"error": "github proxy not configured"}, status_code=503)

    rest = request.path_params["rest"]
    if not _gh_path_in_scope(rest, settings.data_repo):
        return JSONResponse({"error": "path out of scope"}, status_code=403)
    if request.method not in GH_ALLOWED_METHODS:
        return JSONResponse({"error": "method not allowed"}, status_code=405)

    headers = {
        "Accept": request.headers.get("accept", "application/vnd.github+json"),
        "Authorization": f"Bearer {settings.github_pat}",
        "User-Agent": "jadelens-proxy",
    }
    content_type = request.headers.get("content-type")
    if content_type:
        headers["Content-Type"] = content_type

    body = await request.body()
    client: httpx.AsyncClient = request.app.state.http
    upstream = await client.request(
        request.method,
        f"{GITHUB_API}/{rest}",
        params=request.url.query,  # raw query string, e.g. "recursive=1"
        content=body or None,
        headers=headers,
    )

    resp_headers = {
        h: upstream.headers[h]
        for h in GH_PASSTHROUGH_RESPONSE_HEADERS
        if h in upstream.headers
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
    )


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Starlette:
    """Build the app. `transport` lets tests inject an httpx MockTransport."""
    settings = settings or Settings.from_env()
    # Constructed eagerly (available even without lifespan, e.g. a plain
    # TestClient); lifespan just closes it on shutdown.
    client = httpx.AsyncClient(transport=transport, timeout=30.0)

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await client.aclose()

    middleware = [
        # Outermost: answers CORS preflight and stamps headers on every response
        # (including the 401s from the auth layer below).
        Middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        ),
        Middleware(CallerAuthMiddleware, token=settings.proxy_token),
    ]
    routes = [
        Route("/healthz", healthz, methods=["GET"]),
        Route("/gh/{rest:path}", gh_proxy, methods=sorted(GH_ALLOWED_METHODS)),
    ]
    app = Starlette(routes=routes, middleware=middleware, lifespan=lifespan)
    app.state.settings = settings
    app.state.http = client
    return app


# Module-level ASGI app for uvicorn (`uvicorn app.main:app`).
app = create_app()
