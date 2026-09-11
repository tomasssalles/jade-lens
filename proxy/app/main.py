"""JADE LENS secrets proxy — Phase 0 skeleton.

A stateless authenticated forwarder. Phase 0 provides only the shell: a health
check, caller-auth on every other route, and CORS locked to the app origin(s).
Real routes (GitHub, LLM, STT) are added in later phases.
"""

from __future__ import annotations

import hmac

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


def create_app(settings: Settings | None = None) -> Starlette:
    settings = settings or Settings.from_env()
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
    routes = [Route("/healthz", healthz, methods=["GET"])]
    return Starlette(routes=routes, middleware=middleware)


# Module-level ASGI app for uvicorn (`uvicorn app.main:app`).
app = create_app()
