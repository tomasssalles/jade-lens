"""Runtime configuration, read from the environment.

Kept stdlib-only (no pydantic) — the proxy's config surface is tiny. Secrets are
injected by the platform (Cloud Run → Secret Manager) in prod, or a gitignored
`.env` sourced into the shell in local dev.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    # Shared bearer token the web app must present on every non-public request.
    # This is the single credential the browser holds (revocable, scoped) — the
    # real provider/GitHub secrets never leave the proxy.
    proxy_token: str

    # Exact browser origins allowed by CORS (e.g. the GitHub Pages origin and a
    # localhost dev origin). Empty = no cross-origin browser access.
    allowed_origins: list[str] = field(default_factory=list)

    # GitHub PAT, injected server-side on /gh forwards. The browser never sees it.
    github_pat: str = ""
    # The single data repo the /gh route is scoped to, as "owner/repo".
    data_repo: str = ""

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            proxy_token=os.environ.get("PROXY_TOKEN", ""),
            allowed_origins=[
                o.strip()
                for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
                if o.strip()
            ],
            github_pat=os.environ.get("GITHUB_PAT", ""),
            data_repo=os.environ.get("DATA_REPO", ""),
        )
