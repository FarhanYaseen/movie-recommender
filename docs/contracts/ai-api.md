# AI API contracts (frozen 2026-10-08)

Frozen before backend/frontend workstreams diverge, per the implementation brief.
Any change must be recorded here **before** frontend integration.

## Services, ports, env vars

| Service | Local port | Compose service | Notes |
|---|---|---|---|
| PostgreSQL + pgvector | 5432 | `postgres` | Shared by legacy Node API and new backend |
| FastAPI AI backend | 8000 | `api` | Owns migrations for the new tables |
| Ingestion worker | — | runs inside `api` | Single asyncio worker polling the jobs table |
| Next.js frontend | 3000 | `web` | Dev fallback 3001 when legacy Node API occupies 3000 |
| Legacy Node API | 3100 | `legacy` (optional profile) | Kept as a working sample; not required for the demo journey |

Backend env (see `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_MIN` (60),
`VOYAGE_API_KEY`, `VOYAGE_MODEL` (voyage-3), `EMBEDDING_DIMENSIONS` (1024), `EMBEDDING_RPM` (3),
`EMBEDDING_TIMEOUT_S` (30), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (claude-opus-5-5),
`CHUNK_SIZE` (800), `CHUNK_OVERLAP` (150), `MAX_UPLOAD_BYTES` (2097152),
`AGENT_MAX_TOOL_ROUNDS` (3), `CHAT_MAX_OUTPUT_TOKENS` (1024), `CHAT_TIMEOUT_S` (120),
`USER_DAILY_MESSAGE_LIMIT` (200), `ENABLE_DEMO_SEED`,
`DEMO_USER_A_EMAIL`/`DEMO_USER_A_PASSWORD`, `DEMO_USER_B_EMAIL`/`DEMO_USER_B_PASSWORD`.

Frontend env: `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8000`).

Generation provider: **Anthropic** (`anthropic` Python SDK), model from `ANTHROPIC_MODEL`,
default `claude-opus-5-5`, behind a provider interface (`app/providers/`). CI uses mocks.
Embeddings: Voyage AI `voyage-3`, 1024 dims — identical to the legacy catalog so catalog
and document vectors stay dimensionally compatible. Embedding model + dimensions are
recorded per document; mixed models in one search are rejected.

## Auth

- `POST /api/auth/login` — JSON `{ "email": string, "password": string }` →
  `200 { "access_token": string, "token_type": "bearer", "expires_in": int_seconds, "user": { "id": uuid, "email": string } }`.
  Invalid credentials → 401. Credentials/tokens are never logged.
- All other `/api/*` routes (except health) require `Authorization: Bearer <token>`.
  Missing/expired/invalid token → 401. Tokens are JWT HS256, expiring, no refresh tokens
  in this delivery (documented limitation).
- Two demo users are seeded only when `ENABLE_DEMO_SEED=true`, from env values.

## Error shape

All non-2xx JSON responses:

```json
{ "error": { "code": "STABLE_CODE", "message": "safe human message", "request_id": "req_..." } }
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`RATE_LIMITED` (429, user quota), `UPSTREAM_ERROR` (502), `NOT_CONFIGURED` (503),
`INTERNAL_ERROR` (500). **FastAPI request-validation errors are normalized to this shape
with HTTP 400** (not 422). `X-Request-ID` response header mirrors `request_id`.
Provider stack traces / raw provider bodies never reach the browser.

## Documents & jobs

- `POST /api/documents` — multipart: `file` (UTF-8 `.txt`/`.md`, ≤ `MAX_UPLOAD_BYTES`),
  optional `title` field. → `202 { "document_id": uuid, "job_id": uuid, "status": "pending" }`.
  Re-uploading identical content (same SHA-256) for the same user returns **HTTP 200** with
  the existing document's ids and `"status": "duplicate"` (idempotent, no re-ingestion;
  clients treat any 2xx with `status: "duplicate"` as already-ingested and do not poll the job).
- `GET /api/documents` → `{ "data": [ { "id", "title", "source_name", "status":
  "pending"|"processing"|"ready"|"failed", "chunk_count": int, "created_at" } ] }` (owner-scoped).
- `GET /api/jobs/{job_id}` → `{ "id", "document_id", "status": "pending"|"processing"|
  "completed"|"failed", "completed_chunks": int, "total_chunks": int|null, "error": string|null }`
  (owner-scoped; `error` is a safe message).
- `GET /api/documents/{document_id}/chunks/{chunk_id}` →
  `{ "id", "document_id", "document_title", "ordinal": int, "start_offset": int,
  "end_offset": int, "text": string }` (owner-scoped; used by citation inspection).

## Search

- `POST /api/search` — `{ "query": string (1..1000 chars), "limit": int 1..20 default 8,
  "document_ids": uuid[] optional (must be owned) }` →
  `{ "query", "data": [ { "chunk_id", "document_id", "document_title", "ordinal",
  "score": float, "snippet": string } ] }`. Ownership filter is applied in SQL before scoring
  results are returned.

## Chat (SSE)

- `POST /api/chat/stream` — JSON `{ "message": string (1..2000), "conversation_id": uuid
  optional (must be owned), "mode": "rag" | "agent" }`. Response is `text/event-stream`.
  Frontend uses streaming `fetch` with the bearer header (EventSource cannot send headers)
  and must parse SSE frames across arbitrary network chunk boundaries.

Event order and payloads (every event's `data:` is JSON):

| event | payload | notes |
|---|---|---|
| `meta` | `{ "request_id", "conversation_id", "mode", "model" }` | always first |
| `retrieval` | `{ "chunks": [ { "chunk_id", "document_id", "document_title", "ordinal", "score" } ] }` | rag mode, before generation |
| `tool_start` | `{ "round": int, "tool": string, "arguments": object }` | agent mode; arguments are the validated inputs |
| `tool_result` | `{ "round": int, "tool": string, "result_summary": string, "count": int }` | safe summary, not raw rows |
| `delta` | `{ "text": string }` | answer text chunks |
| `citations` | `{ "citations": [ { "chunk_id", "document_id", "document_title", "ordinal" } ] }` | only ids present in this request's authorized retrieval/tool results |
| `done` | `{ "status": "complete" \| "insufficient_evidence" \| "failed", "request_id" }` | terminal, always sent |
| `error` | `{ "code", "message", "request_id" }` | emitted before a `done` with status `failed` |

Insufficient evidence: when retrieval yields nothing usable, the server streams a short
explicit statement and `done.status = "insufficient_evidence"` — similarity scores are
never presented as calibrated confidence. On client disconnect the provider stream is
aborted. No automatic retry ever re-streams already-delivered text.

## Clarifications recorded during Stage 1 (lead-approved)

- Chunk `ordinal` is **0-based** everywhere (storage, search results, citations); UIs may
  display `ordinal + 1`.
- `meta.conversation_id` is always present (the server creates the conversation on first
  message) and is what clients echo back on subsequent sends.
- The `retrieval` event may be surfaced in UIs as a count; `citations` carries the
  clickable sources.

## Agent mode tools (allowlisted, max `AGENT_MAX_TOOL_ROUNDS` rounds)

- `search_catalog(query: str, limit: int<=10, genre?: str, year_from?: int, year_to?: int)` —
  public catalog vector search + parameterized filters.
- `get_movie_details(movie_id: int)` — one catalog record.
- `search_documents(query: str, limit: int<=10, document_ids?: uuid[])` — the authenticated
  user's documents only. Tenant identity is injected by server code; it is **not** a tool argument.

Native Anthropic tool calling (no extra framework). Tool inputs are schema-validated before
execution; invalid inputs return a safe tool error to the model. No SQL/HTTP/filesystem/shell
tools. Budgets: 3 rounds, `CHAT_MAX_OUTPUT_TOKENS` per turn, `CHAT_TIMEOUT_S` wall clock.

## Health

- `GET /health/live` → `200 { "status": "ok" }`.
- `GET /health/ready` → `200 { "status": "ready" }` or `503 { "status": "not_ready" }`
  (checks DB connectivity; never includes secrets or private content).

## Data model (backend owns migrations; Alembic)

`users` (id uuid pk, email unique, password_hash, created_at) ·
`documents` (id uuid pk, user_id fk, title, source_name, checksum sha256, status,
embedding_model, embedding_dimensions, created_at; unique (user_id, checksum)) ·
`chunks` (id uuid pk, document_id fk, ordinal, start_offset, end_offset, text,
content_hash, embedding vector(1024); unique (document_id, ordinal); HNSW cosine index) ·
`jobs` (id uuid pk, document_id fk, user_id fk, status, completed_chunks, total_chunks,
error, updated_at) · `conversations` (id uuid pk, user_id fk, title, created_at) ·
`messages` (id uuid pk, conversation_id fk, role, content, created_at).

The legacy `movies` table is preserved untouched; both a clean install and an upgrade from
the reviewed schema must work (migrations never drop or rewrite `movies`).
