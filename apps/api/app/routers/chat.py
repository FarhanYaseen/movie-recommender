# app/routers/chat.py
# SSE chat endpoint. Pre-stream failures (validation, quota, unowned
# conversation, provider unconfigured) surface as normal JSON errors;
# once streaming starts, failures become error + done(failed) events.

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db, get_session_factory
from ..models import User
from ..providers.base import GenerationProvider
from ..schemas import ChatRequest
from ..services.generation import chat_stream

router = APIRouter(prefix="/api/chat", tags=["chat"])


def get_provider() -> GenerationProvider:
    # Imported lazily so tests can override this dependency without the SDK
    from ..providers.anthropic_provider import AnthropicProvider

    return AnthropicProvider()


def _format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/stream")
def stream_chat(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    provider: GenerationProvider = Depends(get_provider),
    _db: Session = Depends(get_db),
):
    # The stream outlives the request-scoped session dependency, so it gets
    # its own session for the duration of the generator.
    def generate():
        session = get_session_factory()()
        try:
            for sse_event in chat_stream(
                session,
                user,
                provider,
                body.message.strip(),
                body.conversation_id,
                body.mode,
            ):
                yield _format_sse(sse_event.event, sse_event.data)
        finally:
            session.close()

    # Quota/conversation checks happen inside chat_stream before the first
    # event; run the generator to its first event so those raise as HTTP
    # errors rather than a 200 stream that immediately errors.
    iterator = generate()
    first_event = next(iterator)

    def with_first():
        yield first_event
        yield from iterator

    return StreamingResponse(
        with_first(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
