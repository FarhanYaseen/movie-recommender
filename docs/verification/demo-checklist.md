# Reproducible demo checklist

A step-by-step script for recording or presenting the demo journey. Everything here was
executed live on 2026-10-08 except the final generation step, which requires Anthropic
API credits (see `docs/verification/final-report.md`).

## Setup

1. `cp .env.example .env`, set `VOYAGE_API_KEY` and `ANTHROPIC_API_KEY` (an account with credits).
2. `docker compose up -d --build` — wait for `docker compose ps` to show healthy postgres.
   (Without Docker: see `apps/api/README.md` and `apps/web/README.md`.)
3. Open http://localhost:3000.

## Journey

1. **Login** as `alice@example.com` / `alice-demo-password`. Expect redirect to Documents.
2. **Upload** `evals/fixtures/documents/nolan-time-essay.md`. Expect a progress bar
   driven by job polling; status reaches "ready" (first ingestion takes ~30–60 s on the
   free Voyage tier). Re-upload the same file: expect an "already ingested" notice, no
   second list entry.
3. **Chat (RAG mode):** ask *"What does the essay say about Inception and clock
   speeds?"*. Expect: streamed answer, source cards citing `nolan-time-essay.md`;
   clicking a card opens the exact chunk text.
4. **Insufficient evidence:** ask *"What is the best pizza restaurant in Naples?"*.
   Expect the explicit can't-answer state, no invented citations.
5. **Agent mode:** toggle to Agent and ask *"Find me a movie in the catalog about dreams,
   and check whether my documents say anything about it."* Expect a tool-activity trail
   (`search_catalog`, `search_documents`) followed by a cited answer.
6. **Isolation:** log out, log in as `bob@example.com` / `bob-demo-password`. Documents
   list is empty; the same chat questions produce insufficient-evidence (bob has no
   documents); alice's sources are not reachable.
7. **Stop/cancel:** start a question and press Stop mid-stream. Expect the cancelled
   state, and a retry that does not duplicate messages.

## Evidence captured without credits (2026-10-08)

Steps 1, 2, 6 ran live end-to-end. Step 3 ran live through retrieval (correct document
ranked first) and then failed safely at the provider call (`error` + `done(failed)`
events) because the API account had no credits — the UI's failed state is the expected
rendering for that. Steps 4, 5, 7 are covered by mocked backend/frontend tests.
