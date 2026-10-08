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

1. ~~Anthropic credits~~ **Resolved 2026-10-08**: the original `.env` key belonged to
   an unfunded org; swapped for a key from the funded org. Live generation then verified
   end to end: legacy `/ask` SSE streamed a grounded answer recommending only movies in
   its `sources`; RAG chat streamed 62 deltas with inline [S#] markers, a `citations`
   event of authorized chunks only, and `done(complete)`; agent mode made real tool
   calls (`search_catalog` → `search_documents`), stayed within round limits, and
   produced a correct cited answer joining catalog and user-document knowledge.
2. ~~Embedding-failure mapping bug~~ **Fixed**: the live failure was a transient DNS
   `httpx.ConnectError` escaping the Voyage client uncaught. Network errors are now
   retried like timeouts and exhaust to 502 `UPSTREAM_ERROR`; covered by
   `apps/api/tests/test_embedding_client.py` (backend suite 43/43).
3. ~~Compose live run~~ **Verified 2026-10-08**: `docker compose up --build` (ports
   shifted via an override file to avoid local services) built and started all three
   services; postgres healthy, `/health/ready` → ready, web served, demo login returned
   a token. Stack torn down after verification.
4. ~~Full live eval~~ **Done** (quiet re-run, 2026-10-08): Recall@1 0.92, Recall@4
   1.00, MRR 0.958 over 12 in-scope queries; out-of-scope top scores 0.129–0.235.
   Report: `doc-retrieval-report.json` in this directory. Duplicate-upload idempotency
   also exercised live via the HTTP 200 path.

## Case-study guidance (truthful claims)

The existing case study remains accurate. Once Compose verification and credits land,
these claims are now supportable: multi-user document RAG with owner-scoped retrieval
verified by tests and live checks; streamed SSE answers with programmatically validated
citations; bounded 3-tool agent mode (mock-verified); jest 76 / pytest 43 / vitest 26
green; live document retrieval Recall@1 0.92 / Recall@4 1.00 / MRR 0.958 on a labeled
fixture set; Compose stack verified end to end. Do **not** claim live generation,
latency figures, or a deployed demo until verified (generation awaits API credits).
