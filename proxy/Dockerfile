FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# Deps first, so this layer caches independently of source changes.
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

# Cloud Run provides $PORT (default 8080). Shell form so it expands.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
