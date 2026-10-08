# Implementation status — AI RAG application

Branch: `feat/ai-rag-app` · Brief baseline: `596c93b` · Started: 2026-10-08

Work completed between the brief's review and this branch (commits `b08a227`..`3924a98`
on main, preserved here): ESLint flat-config repair, grounded `/ask` endpoint with SSE,
retrieval eval harness (hit@k 1.00), jest+supertest suite, README/OpenAPI/Postman docs,
package metadata placeholders fixed. Findings from the brief already resolved by that
work are marked ✓ below.

## Stage 0 — contracts (integration lead)
- [x] Branch created, baseline recorded
- [x] `docs/contracts/ai-api.md` frozen (HTTP, SSE, auth, data, env, ports)
- [x] Brief findings re-verified at HEAD (repeated `q` → 500 confirmed; legacy `/recommend` → 404 confirmed; NaN `limit` path confirmed; lint ✓ fixed; tests ✓ exist; placeholders ✓ fixed)

## Workstream A — existing Node API reliability (merged `ws-a-node-reliability`)
- [x] Lint configuration (✓ done pre-branch)
- [x] Input validation before paid embedding calls (q single string ≤2000; limit 1..50; reject arrays/NaN; movie id positive int)
- [x] Legacy `/recommend` route fixed and tested against canonical route
- [x] Concurrency-safe configurable rate limiter; timeouts; bounded retries with jitter honoring Retry-After; no retry on auth/validation errors
- [x] Batch document-embedding method (`embedDocuments`) with index-correct mapping and dimension validation
- [x] Repeatable seeding: upserts on (title, year), description-hash skip of unchanged rows, resumable; `--reset` flag refused in production
- [x] Legacy UI: textContent rendering, stale-response guard (sequence counter + AbortController), cancellation
- [x] Regression tests (suite now 76 passing on the integration branch)

## Workstream B — FastAPI AI backend (`apps/api/`)
- [ ] Alembic migrations (users, documents, chunks, jobs, conversations, messages); movies table preserved
- [ ] Auth: login, hashed credentials, expiring JWT, env-seeded demo users
- [ ] TXT/MD ingestion: upload → job → deterministic chunking with offsets → batch embeddings → ready
- [ ] PG-backed job state, single worker, resumable without duplicate chunks
- [ ] Owner-scoped retrieval (`/api/search`) with SQL-level ownership filters
- [ ] Grounded chat with SSE (meta/retrieval/delta/citations/done/error), insufficient-evidence path, citation validation
- [ ] Agent mode: 3 allowlisted tools, schema validation, ≤3 rounds, budgets
- [ ] Error shape + request IDs; health endpoints; no provider internals leaked
- [ ] pytest suite: providers mocked; ownership and streaming covered

## Workstream C — Next.js frontend (`apps/web/`)
- [ ] Login, documents/upload + job status, chat with RAG/agent toggle
- [ ] Streaming fetch SSE parser safe across chunk boundaries; stop + retry without duplicates
- [ ] Source cards opening cited chunk text; tool activity display
- [ ] Loading/empty/failed/insufficient-evidence/cancelled/completed states
- [ ] Safe rendering (no untrusted HTML), keyboard accessible
- [ ] Tests: SSE parsing, error states, cancellation

## Workstream D — evaluation & proof (`evals/`, `tests/e2e/`, `docs/verification/`)
- [x] Catalog retrieval evals (✓ hit@k harness pre-branch)
- [ ] Labeled document-retrieval fixtures incl. out-of-scope questions; Recall@k / MRR
- [ ] Cross-user authorization scenarios
- [ ] End-to-end journey test with deterministic fixtures
- [ ] Opt-in live evaluation command; reports record model/settings/environment

## Integration
- [ ] Docker Compose: postgres + api + web (+ optional `legacy` profile)
- [ ] GitHub Actions CI without paid credentials
- [ ] `.env.example` updated for all services
- [ ] Root README: truthful feature list, demo journey, limitations, deferred work
- [ ] `docs/verification/final-report.md`

## Material assumptions / decisions
- Generation provider: Anthropic (key present in `.env`); **account currently has zero
  credit balance**, so live generation is blocked until credits are added. CI and tests
  are fully mocked; this is recorded as the live-demo blocker, not worked around.
- Docker daemon is not running locally; Compose files are authored and validated
  syntactically, with live Compose verification listed as unverified if still true at handoff.
- Local Postgres role mismatch (`.env` names `foreclosure_user`; local superuser is
  `farhanyaseen`) — local runs use env overrides; Compose provisions its own role.
- Embedding input stays description-only for the catalog (changing it requires versioned
  re-embedding of all records; deferred, recorded per brief §A7).
- Voyage free tier is 3 RPM shared across processes; limiter default `EMBEDDING_RPM=3`.
