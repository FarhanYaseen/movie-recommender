# Movie RAG API (FastAPI backend)

The AI backend from `docs/contracts/ai-api.md`: authenticated document ingestion,
owner-scoped pgvector retrieval, grounded SSE chat with validated citations, and a
bounded three-tool agent mode. Generation uses Anthropic (`ANTHROPIC_MODEL`, default
`claude-opus-5-5`); embeddings use Voyage AI (`voyage-3`, 1024 dims — compatible with
the legacy catalog).

## Run locally

```bash
cd apps/api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Point DATABASE_URL at a PostgreSQL 16+ with the pgvector extension available,
# then create the schema (the legacy movies table is left untouched):
DATABASE_URL=postgresql://USER@localhost:5432/movie_recommender .venv/bin/alembic upgrade head

cp .env.example .env   # then fill in keys; the repo-root .env is also read
.venv/bin/uvicorn app.main:app --port 8000
```

Env vars, endpoints, SSE events, and error shape are specified in
`docs/contracts/ai-api.md`. The ingestion worker runs inside the app process
(`WORKER_ENABLED=false` disables it, e.g. for tests).

## Tests

```bash
.venv/bin/python -m pytest
```

The suite uses a disposable local database `movie_recommender_test` (created and
dropped by the fixtures; connection `postgresql://farhanyaseen@localhost:5432` —
adjust `tests/conftest.py` for another local role). Providers are mocked; no
network or API keys are needed. The migration is exercised as an upgrade on top
of a legacy-style `movies` table, and the suite covers auth, upload validation,
duplicate idempotency, resumable ingestion, cross-user isolation (including via
agent tools), SSE event order, citation validation, insufficient evidence,
mid-stream failure, quota, round caps, and prompt-injection inertness.

## Notes

- Demo users are seeded only when `ENABLE_DEMO_SEED=true` and passwords are set.
- Access tokens are expiring HS256 JWTs; there are no refresh tokens in this delivery.
- The in-process rate limiter paces Voyage calls per process; it is not a
  distributed quota guarantee.
