from __future__ import annotations

from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-token-123"
ORIGIN = "http://localhost:5173"


def make_client() -> TestClient:
    app = create_app(Settings(proxy_token=TOKEN, allowed_origins=[ORIGIN]))
    return TestClient(app)


def test_healthz_is_public() -> None:
    r = make_client().get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_protected_path_requires_token() -> None:
    r = make_client().get("/gh/anything")
    assert r.status_code == 401


def test_protected_path_rejects_bad_token() -> None:
    r = make_client().get("/gh/anything", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_valid_token_passes_auth() -> None:
    # No /gh route exists yet, so a valid token yields 404 (not 401) — which
    # proves the request got past the auth layer.
    r = make_client().get("/gh/anything", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 404


def test_x_proxy_token_header_accepted() -> None:
    r = make_client().get("/gh/anything", headers={"X-Proxy-Token": TOKEN})
    assert r.status_code == 404


def test_cors_preflight_allowed_origin_needs_no_token() -> None:
    r = make_client().options(
        "/gh/anything",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == ORIGIN
