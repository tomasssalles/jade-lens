# Pinned uv gives byte-for-byte the same dependency resolution as local dev.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /srv

# Install the locked runtime deps first (no dev, no project) so this layer
# caches independently of source changes. --frozen fails if the lock is stale.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# Cloud Run provides $PORT (default 8080). Shell form so it expands.
CMD ["sh", "-c", ".venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
