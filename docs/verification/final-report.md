# Verification report — AI RAG application

Branch: `feat/ai-rag-app` · Brief baseline: `596c93b` · Date: 2026-10-08

## Checks that passed (mocked, no paid calls)

- Legacy Node API: `npm run lint` clean; `npm test` 76/76 (validation, limiter
  concurrency with fake timers, retry/backoff, batch embedding mapping, seed planning,
  legacy-alias parity, /ask, health).
- FastAPI backend: `apps/api` pytest 39/39 against a disposable local Postgres with the
  Alembic migration applied **on top of a legacy-style `movies` table** (upgrade path),
  Voyage/Anthropic mocked. Covers auth, upload validation, duplicate idempotency (pinned
  to HTTP 200), chunker determinism, interrupted-ingestion resume, cross-user isolation,
  SSE event order, fabricated-citation dropping, insufficient evidence, mid-stream
  errors, daily quota, agent tool invocation/round cap/malformed args/prompt-injection
  inertness.
- Next.js frontend: vitest 26/26, `tsc --noEmit` clean, production build succeeds
  (verified again on the merged tree).
- `docker compose config` validates.

## Live checks (real services, 2026-10-08)

- Alembic migrations ran against the real seeded database; all 15 `movies` rows intact.
- API served with demo seed: health live/ready OK; bad login 401; missing token 401;
  contract error shape with request IDs confirmed.
- Full ingestion live: 3 fixture documents uploaded → jobs → worker → Voyage batch
  embeddings → status ready.
- Live retrieval evals (document level): first 5 of 12 in-scope queries all ranked their
  expected document **#1** before the run aborted — the operator ran concurrent manual
  API checks that exhausted the shared Voyage free-tier quota (3 RPM), and the search
  endpoint returned 500. Re-run `RUN_LIVE_EVALS=true python3 evals/run-doc-evals.py`
  with no concurrent traffic for the full report (written to this directory).
- Chat stream live (RAG): `meta` → `retrieval` (expected document ranked first) →
  safe `error` (`UPSTREAM_ERROR`, no provider internals) → `done(failed)`. Generation
  itself is blocked because the Anthropic account has **zero credit balance** — the
  documented blocker, not a code defect.
- Cross-user isolation live: user B fetching user A's chunk → 404; user B's search over
  A's content → empty; user B passing A's `document_ids` → 400 "not owned".

## Open items

1. **Anthropic credits** — required for any live generation (legacy `/ask`, chat RAG and
   agent modes). Everything up to the provider call is verified.
2. **Embedding-failure mapping bug (backend)**: when Voyage retries are exhausted
   mid-search, the API returns 500 `INTERNAL_ERROR`; contract says upstream failures are
   502 `UPSTREAM_ERROR`. Reproduce by exceeding the free-tier RPM; fix in the embedding
   service error mapping in `apps/api`.
3. **Compose live run** — the full `docker compose up --build` verification was started
   (daemon available) but had not completed when work stopped; `docker compose config`
   is validated. Re-run per `docs/verification/demo-checklist.md`.
4. Full live eval report JSON pending the quiet re-run in item 3's environment.

## Case-study guidance (truthful claims)

The existing case study remains accurate. Once Compose verification and credits land,
these claims become supportable and may be added: multi-user document RAG with
owner-scoped retrieval verified by tests and live checks; streamed SSE answers with
programmatically validated citations; bounded 3-tool agent mode (mock-verified); jest
76 / pytest 39 / vitest 26 green; document retrieval ranked the expected source #1 in
5/5 live-sampled queries (partial run — full metrics pending). Do **not** claim live
generation, latency figures, or a deployed demo until verified.
