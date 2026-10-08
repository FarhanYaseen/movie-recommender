# tests/test_isolation.py
# Cross-user authorization: user B must never see user A's private records —
# by direct id, through search filters, or through agent tools.

import uuid

from sqlalchemy import select

from app.db import get_session_factory
from app.models import Chunk, Conversation
from app.providers.base import ProviderTurn, ToolUse
from app.services.agent import execute_tool

from tests.conftest import MockProvider, login, read_sse_events, upload_and_ingest

SECRET_TEXT = (
    "Alice's private review notes about the movie Heat. "
    "The secret watchword is XYLOPHONE-77. " * 30
)


def _alice_document(client):
    headers_a = login(client, "alice@test.local")
    body = upload_and_ingest(client, headers_a, "private.md", SECRET_TEXT)
    return headers_a, body


def test_documents_list_is_owner_scoped(client, user_a, user_b):
    _alice_document(client)
    headers_b = login(client, "bob@test.local")
    assert client.get("/api/documents", headers=headers_b).json()["data"] == []


def test_job_not_visible_to_other_user(client, user_a, user_b):
    _, body = _alice_document(client)
    headers_b = login(client, "bob@test.local")
    response = client.get(f"/api/jobs/{body['job_id']}", headers=headers_b)
    assert response.status_code == 404


def test_chunk_fetch_not_visible_to_other_user(client, user_a, user_b):
    _, body = _alice_document(client)
    with get_session_factory()() as db:
        chunk = db.execute(select(Chunk)).scalars().first()
    headers_b = login(client, "bob@test.local")
    response = client.get(
        f"/api/documents/{body['document_id']}/chunks/{chunk.id}", headers=headers_b
    )
    assert response.status_code == 404


def test_search_never_returns_other_users_chunks(client, user_a, user_b):
    _alice_document(client)
    headers_b = login(client, "bob@test.local")
    # Bob searches with the exact text of Alice's document — identical fake
    # embedding, so only the ownership filter keeps it away from him.
    response = client.post(
        "/api/search", json={"query": SECRET_TEXT[:800], "limit": 8}, headers=headers_b
    )
    assert response.status_code == 200
    assert response.json()["data"] == []


def test_search_with_guessed_document_ids_rejected(client, user_a, user_b):
    _, body = _alice_document(client)
    headers_b = login(client, "bob@test.local")
    response = client.post(
        "/api/search",
        json={"query": "anything", "document_ids": [body["document_id"]]},
        headers=headers_b,
    )
    assert response.status_code == 400
    assert "do not own" in response.json()["error"]["message"]


def test_conversation_of_other_user_is_not_reachable(client, user_a, user_b, use_provider):
    with get_session_factory()() as db:
        conversation = Conversation(user_id=user_a.id, title="alice chat")
        db.add(conversation)
        db.commit()
        conversation_id = conversation.id

    use_provider(MockProvider())
    headers_b = login(client, "bob@test.local")
    response = client.post(
        "/api/chat/stream",
        json={"message": "hi", "conversation_id": str(conversation_id), "mode": "rag"},
        headers=headers_b,
    )
    assert response.status_code == 404


def test_agent_search_documents_tool_is_tenant_scoped(client, user_a, user_b):
    _alice_document(client)
    with get_session_factory()() as db:
        from app.models import User

        bob = db.execute(select(User).where(User.email == "bob@test.local")).scalar_one()
        execution = execute_tool(
            db, bob, "search_documents", {"query": SECRET_TEXT[:500]}, label_start=1
        )
    assert execution.count == 0
    assert "XYLOPHONE" not in execution.content


def test_agent_tool_rejects_guessed_document_ids(client, user_a, user_b):
    _, body = _alice_document(client)
    with get_session_factory()() as db:
        from app.models import User

        bob = db.execute(select(User).where(User.email == "bob@test.local")).scalar_one()
        execution = execute_tool(
            db,
            bob,
            "search_documents",
            {"query": "anything", "document_ids": [body["document_id"]]},
            label_start=1,
        )
    assert execution.is_error
    assert "XYLOPHONE" not in execution.content


def test_agent_chat_cannot_leak_other_users_documents(client, user_a, user_b, use_provider):
    _alice_document(client)
    provider = use_provider(
        MockProvider(
            turns=[
                ProviderTurn(
                    text="",
                    tool_uses=[
                        ToolUse(
                            id="tu_1",
                            name="search_documents",
                            input={"query": SECRET_TEXT[:500]},
                        )
                    ],
                    stop_reason="tool_use",
                    raw_content=[
                        {
                            "type": "tool_use",
                            "id": "tu_1",
                            "name": "search_documents",
                            "input": {"query": SECRET_TEXT[:500]},
                        }
                    ],
                ),
                ProviderTurn(text="I found nothing relevant."),
            ]
        )
    )
    headers_b = login(client, "bob@test.local")
    with client.stream(
        "POST", "/api/chat/stream", json={"message": "what are Alice's notes?", "mode": "agent"},
        headers=headers_b,
    ) as response:
        events = read_sse_events(response)

    tool_results = [data for name, data in events if name == "tool_result"]
    assert tool_results and tool_results[0]["count"] == 0
    # the model's tool_result content (second create_turn call) saw no secret
    tool_message = provider.create_calls[1]["messages"][-1]
    assert "XYLOPHONE" not in str(tool_message)
