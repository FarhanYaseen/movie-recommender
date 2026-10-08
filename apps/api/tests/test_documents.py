# tests/test_documents.py
# Upload validation, duplicate idempotency, chunker determinism,
# ingestion resume without duplication.

import uuid

from sqlalchemy import select

from app.db import get_session_factory
from app.models import Chunk, Document, Job
from app.services.chunking import chunk_text
from app.services.ingestion import process_job

from tests.conftest import login, upload_and_ingest

LONG_TEXT = ("Paragraph about the movie Inception and its dream levels. " * 20 + "\n\n") * 5


def test_upload_rejects_bad_extension(client, user_a):
    headers = login(client, "alice@test.local")
    response = client.post(
        "/api/documents", files={"file": ("notes.pdf", b"hello", "application/pdf")}, headers=headers
    )
    assert response.status_code == 400
    assert "txt" in response.json()["error"]["message"]


def test_upload_rejects_invalid_utf8(client, user_a):
    headers = login(client, "alice@test.local")
    response = client.post(
        "/api/documents", files={"file": ("notes.txt", b"\xff\xfe\x00bad", "text/plain")}, headers=headers
    )
    assert response.status_code == 400


def test_upload_rejects_oversize(client, user_a, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_bytes", 100)
    headers = login(client, "alice@test.local")
    response = client.post(
        "/api/documents", files={"file": ("big.txt", b"x" * 200, "text/plain")}, headers=headers
    )
    assert response.status_code == 400
    monkeypatch.undo()


def test_upload_rejects_empty(client, user_a):
    headers = login(client, "alice@test.local")
    response = client.post(
        "/api/documents", files={"file": ("empty.txt", b"", "text/plain")}, headers=headers
    )
    assert response.status_code == 400


def test_upload_and_ingest_happy_path(client, user_a):
    headers = login(client, "alice@test.local")
    body = upload_and_ingest(client, headers, "notes.md", LONG_TEXT)
    assert body["status"] == "pending"

    job = client.get(f"/api/jobs/{body['job_id']}", headers=headers).json()
    assert job["status"] == "completed"
    assert job["completed_chunks"] == job["total_chunks"] > 1

    documents = client.get("/api/documents", headers=headers).json()["data"]
    assert len(documents) == 1
    assert documents[0]["status"] == "ready"
    assert documents[0]["chunk_count"] == job["total_chunks"]


def test_duplicate_upload_is_idempotent(client, user_a):
    headers = login(client, "alice@test.local")
    first = upload_and_ingest(client, headers, "notes.md", LONG_TEXT)
    second = client.post(
        "/api/documents",
        files={"file": ("renamed.md", LONG_TEXT.encode(), "text/plain")},
        headers=headers,
    ).json()
    assert second["status"] == "duplicate"
    assert second["document_id"] == first["document_id"]
    documents = client.get("/api/documents", headers=headers).json()["data"]
    assert len(documents) == 1


def test_chunker_is_deterministic_with_offsets():
    chunks_1 = chunk_text(LONG_TEXT, 800, 150)
    chunks_2 = chunk_text(LONG_TEXT, 800, 150)
    assert chunks_1 == chunks_2
    for chunk in chunks_1:
        assert LONG_TEXT[chunk.start_offset : chunk.end_offset] == chunk.text
    assert [c.ordinal for c in chunks_1] == list(range(len(chunks_1)))
    # consecutive chunks overlap by the configured amount
    assert chunks_1[1].start_offset == chunks_1[0].start_offset + (800 - 150)


def test_interrupted_ingestion_resumes_without_duplicates(client, user_a, monkeypatch):
    headers = login(client, "alice@test.local")
    response = client.post(
        "/api/documents", files={"file": ("notes.md", LONG_TEXT.encode(), "text/plain")}, headers=headers
    )
    body = response.json()
    job_id = uuid.UUID(body["job_id"])

    # First run fails after the first batch (provider outage mid-ingestion)
    calls = {"count": 0}
    from .conftest import fake_vector

    def failing_embed(texts, input_type):
        calls["count"] += 1
        if calls["count"] > 1:
            raise RuntimeError("provider outage")
        return [fake_vector(text) for text in texts]

    monkeypatch.setattr("app.services.ingestion.embed_texts", failing_embed)
    # shrink batches so one run needs several provider calls
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "embedding_batch_size", 2)

    process_job(get_session_factory(), job_id)

    with get_session_factory()() as db:
        job = db.get(Job, job_id)
        assert job.status == "failed"
        assert "embedding" in job.error.lower() or "ingestion" in job.error.lower()
        embedded_before = db.execute(
            select(Chunk).where(Chunk.embedding.is_not(None))
        ).scalars().all()
        partial = len(embedded_before)
        assert partial >= 1

    # Retry with the provider healthy again: only the remaining chunks embed,
    # nothing is duplicated.
    def healthy_embed(texts, input_type):
        return [fake_vector(text) for text in texts]

    monkeypatch.setattr("app.services.ingestion.embed_texts", healthy_embed)
    process_job(get_session_factory(), job_id)

    with get_session_factory()() as db:
        job = db.get(Job, job_id)
        document = db.get(Document, job.document_id)
        assert job.status == "completed"
        assert document.status == "ready"
        chunks = db.execute(
            select(Chunk).where(Chunk.document_id == document.id)
        ).scalars().all()
        ordinals = sorted(chunk.ordinal for chunk in chunks)
        assert ordinals == list(range(len(chunks)))  # no duplicates
        assert all(chunk.embedding is not None for chunk in chunks)
        assert job.completed_chunks == len(chunks)


def test_repeated_process_job_is_a_noop(client, user_a):
    headers = login(client, "alice@test.local")
    body = upload_and_ingest(client, headers, "notes.md", LONG_TEXT)
    job_id = uuid.UUID(body["job_id"])
    with get_session_factory()() as db:
        count_before = len(db.execute(select(Chunk)).scalars().all())
    process_job(get_session_factory(), job_id)
    with get_session_factory()() as db:
        count_after = len(db.execute(select(Chunk)).scalars().all())
    assert count_before == count_after
