from __future__ import annotations

import httpx
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-token-123"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def make_client(*, github_pat: str = "PAT", data_repo: str = "o/r"):
    """Client whose upstream GitHub calls are captured by a MockTransport."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True}, headers={"ETag": "abc"})

    app = create_app(
        Settings(
            proxy_token=TOKEN,
            allowed_origins=["http://localhost:5173"],
            github_pat=github_pat,
            data_repo=data_repo,
        ),
        transport=httpx.MockTransport(handler),
    )
    return TestClient(app), seen


def test_forwards_with_injected_pat_and_strips_proxy_token() -> None:
    client, seen = make_client()
    r = client.get("/gh/repos/o/r", headers=AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert len(seen) == 1
    fwd = seen[0]
    assert str(fwd.url) == "https://api.github.com/repos/o/r"
    assert fwd.headers["authorization"] == "Bearer PAT"  # PAT, not the proxy token


def test_forwards_query_string() -> None:
    client, seen = make_client()
    r = client.get("/gh/repos/o/r/git/trees/main?recursive=1", headers=AUTH)
    assert r.status_code == 200
    params = httpx.QueryParams(seen[0].url.query.decode())
    assert params.get("recursive") == "1"


def test_out_of_scope_repo_is_forbidden_and_not_forwarded() -> None:
    client, seen = make_client()
    r = client.get("/gh/repos/someone/else", headers=AUTH)
    assert r.status_code == 403
    assert seen == []


def test_requires_caller_token() -> None:
    client, seen = make_client()
    r = client.get("/gh/repos/o/r")
    assert r.status_code == 401
    assert seen == []


def test_disallowed_method_rejected() -> None:
    client, seen = make_client()
    r = client.request("DELETE", "/gh/repos/o/r", headers=AUTH)
    # No DELETE route registered → Starlette returns 405 before forwarding.
    assert r.status_code == 405
    assert seen == []


def test_503_when_not_configured() -> None:
    client, _ = make_client(github_pat="", data_repo="")
    r = client.get("/gh/repos/o/r", headers=AUTH)
    assert r.status_code == 503
