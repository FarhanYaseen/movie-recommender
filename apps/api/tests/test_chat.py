# tests/test_chat.py
# SSE event order, server-side citation validation, insufficient evidence,
# mid-stream errors, quota.

from app.errors import UpstreamError

from tests.conftest import (
    MockProvider,
    first_chunk_text,
    login,
    read_sse_events,
    upload_and_ingest,
)

DOC_TEXT = (
    "Blade Runner 2049 is a 2017 sequel directed by Denis Villeneuve. "
    "It follows officer K, a replicant blade runner. " * 30
)


def _ready_document(client, headers):
    return upload_and_ingest(client, headers, "notes.md", DOC_TEXT)


def test_rag_stream_event_order_and_citations(client, user_a, use_provider):
    headers = login(client, "alice@test.local")
    _ready_document(client, headers)
    use_provider(MockProvider(stream_chunks=["It follows officer K ", "[S1]."]))

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"message": first_chunk_text(DOC_TEXT), "mode": "rag"},
        headers=headers,
    ) as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        events = read_sse_events(response)

    names = [name for name, _ in events]
    assert names[0] == "meta"
    assert names[1] == "retrieval"
    assert "delta" in names
    assert names[-2] == "citations"
    assert names[-1] == "done"

    meta = events[0][1]
    assert meta["mode"] == "rag" and meta["model"] == "mock-model"
    assert meta["request_id"].startswith("req_")

    retrieval = events[1][1]
    assert len(retrieval["chunks"]) >= 1
    citations = events[-2][1]["citations"]
    assert len(citations) == 1
    assert citations[0]["chunk_id"] == retrieval["chunks"][0]["chunk_id"]
    assert events[-1][1]["status"] == "complete"


def test_fabricated_citation_labels_are_dropped(client, user_a, use_provider):
    headers = login(client, "alice@test.local")
    _ready_document(client, headers)
    # Model cites S1 (real) and S9 (fabricated — not in the authorized set)
    use_provider(MockProvider(stream_chunks=["Real [S1], fake [S9]."]))

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"message": first_chunk_text(DOC_TEXT), "mode": "rag"},
        headers=headers,
    ) as response:
        events = read_sse_events(response)

    citations = next(data for name, data in events if name == "citations")["citations"]
    assert len(citations) == 1  # S9 dropped


def test_insufficient_evidence_path(client, user_a, use_provider):
    headers = login(client, "alice@test.local")
    _ready_document(client, headers)
    provider = use_provider(MockProvider())

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"message": "completely unrelated query about gardening", "mode": "rag"},
        headers=headers,
    ) as response:
        events = read_sse_events(response)

    assert events[-1][1]["status"] == "insufficient_evidence"
    assert provider.stream_calls == []  # no generation call was made
    deltas = "".join(data["text"] for name, data in events if name == "delta")
    assert "don't have enough" in deltas
    citations = next(data for name, data in events if name == "citations")["citations"]
    assert citations == []


def test_no_documents_at_all_is_insufficient_evidence(client, user_a, use_provider):
    headers = login(client, "alice@test.local")
    use_provider(MockProvider())
    with client.stream(
        "POST", "/api/chat/stream", json={"message": "anything", "mode": "rag"}, headers=headers
    ) as response:
        events = read_sse_events(response)
    assert events[-1][1]["status"] == "insufficient_evidence"


def test_error_mid_stream_emits_error_then_failed_done(client, user_a, use_provider):
    headers = login(client, "alice@test.local")
    _ready_document(client, headers)
    use_provider(
        MockProvider(stream_chunks=["partial "], stream_error=UpstreamError("provider died"))
    )

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"message": first_chunk_text(DOC_TEXT), "mode": "rag"},
        headers=headers,
    ) as response:
        events = read_sse_events(response)

    names = [name for name, _ in events]
    assert "delta" in names  # partial output was streamed
    error_event = next(data for name, data in events if name == "error")
    assert error_event["code"] == "UPSTREAM_ERROR"
    assert "provider died" in error_event["message"]
    assert events[-1][1]["status"] == "failed"


def test_chat_validation_errors_are_http_400(client, user_a):
    headers = login(client, "alice@test.local")
    response = client.post(
        "/api/chat/stream", json={"message": "", "mode": "rag"}, headers=headers
    )
    assert response.status_code == 400
    response = client.post(
        "/api/chat/stream", json={"message": "hi", "mode": "swarm"}, headers=headers
    )
    assert response.status_code == 400


def test_daily_quota_is_enforced_as_http_429(client, user_a, use_provider, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "user_daily_message_limit", 1)
    headers = login(client, "alice@test.local")
    use_provider(MockProvider())

    with client.stream(
        "POST", "/api/chat/stream", json={"message": "first", "mode": "rag"}, headers=headers
    ) as response:
        read_sse_events(response)

    response = client.post(
        "/api/chat/stream", json={"message": "second", "mode": "rag"}, headers=headers
    )
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"


def test_conversation_persists_and_continues(client, user_a, use_provider):
    headers = login(client, "alice@test.local")
    _ready_document(client, headers)
    use_provider(MockProvider(stream_chunks=["answer one"]))

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"message": first_chunk_text(DOC_TEXT), "mode": "rag"},
        headers=headers,
    ) as response:
        events = read_sse_events(response)
    conversation_id = events[0][1]["conversation_id"]

    provider = MockProvider(stream_chunks=["answer two"])
    client.app.dependency_overrides.clear()
    from app.routers.chat import get_provider

    client.app.dependency_overrides[get_provider] = lambda: provider

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={
            "message": first_chunk_text(DOC_TEXT),
            "conversation_id": conversation_id,
            "mode": "rag",
        },
        headers=headers,
    ) as response:
        events2 = read_sse_events(response)

    assert events2[0][1]["conversation_id"] == conversation_id
    # history (first exchange) was included in the provider call
    history_roles = [m["role"] for m in provider.stream_calls[0]["messages"]]
    assert history_roles.count("assistant") >= 1
