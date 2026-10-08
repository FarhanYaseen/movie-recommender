# Movie RAG — web frontend

Next.js (App Router) + TypeScript UI for the FastAPI AI backend. Implements the
journey from the implementation brief: sign in → upload a text/Markdown document →
watch ingestion progress → ask questions and get a streamed, cited answer, in RAG
or agent mode.

## Run

```bash
npm install
npm run dev          # http://localhost:3000 (use `npm run dev -- -p 3001` if the
                     # legacy Node API is already using port 3000)
```

The backend is expected at `http://localhost:8000`; override with
`NEXT_PUBLIC_API_BASE_URL`. Sign in with the demo users seeded by the backend
(see the root `.env.example`).

## Checks

```bash
npm test             # vitest: SSE parser, chat state machine, stream transport,
                     # login + source-card error states (no network access)
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

## Notes

- **Streaming:** `lib/sse.ts` is a pure incremental SSE parser (frames split across
  arbitrary network chunks, CRLF, multi-line `data:`). `lib/chat.ts` holds the chat
  state machine as a pure reducer plus the `fetch`-based transport; the Stop button
  and unmount abort the stream via `AbortController`.
- **Auth/token storage:** the JWT lives in React state and is mirrored to
  `sessionStorage` so a refresh keeps the session. Trade-off: `sessionStorage` is
  readable by same-origin scripts, so an XSS hole would expose the token. The app
  renders all remote content as plain text (no `dangerouslySetInnerHTML`) and tokens
  expire; production should move to httpOnly cookies set by the backend.
- **Safety:** model/document text is always rendered as text; provider keys never
  reach the browser; tool activity shows validated arguments and result summaries,
  never chain-of-thought.
- **States:** loading, empty, failed (with retry that never duplicates messages),
  insufficient-evidence, cancelled, and completed are all distinct in the UI, with
  an `aria-live` announcement for streaming status changes.
