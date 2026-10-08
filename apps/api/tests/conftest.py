# tests/conftest.py
# Integration fixtures: real disposable PostgreSQL (movie_recommender_test),
# migrations applied via alembic on top of a legacy-style movies table
# (verifying the upgrade path), providers mocked, worker disabled.

import hashlib
import os
import random
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))

TEST_DB_URL = "postgresql://farhanyaseen@localhost:5432/movie_recommender_test"

os.environ.update(
    {
        "DATABASE_URL": TEST_DB_URL,
        "WORKER_ENABLED": "false",
        "ENABLE_DEMO_SEED": "false",
        "JWT_SECRET": "test-secret-0123456789-0123456789-0123",
        "JWT_EXPIRES_MIN": "60",
        "VOYAGE_API_KEY": "test-voyage-key",
        "ANTHROPIC_API_KEY": "test-anthropic-key",
        "USER_DAILY_MESSAGE_LIMIT": "200",
        "CHUNK_SIZE": "800",
        "CHUNK_OVERLAP": "150",
    }
)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.db import get_session_factory, reset_engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402
from app.providers.base import GenerationProvider, ProviderTurn  # noqa: E402
from app.routers.chat import get_provider  # noqa: E402

ADMIN_DSN = "host=localhost user=farhanyaseen dbname=postgres"


def fake_vector(text: str) -> list[float]:
    """Deterministic pseudo-embedding: identical text -> identical unit vector,
    different text -> effectively orthogonal (similarity ~0)."""
    seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")
    rng = random.Random(seed)
    values = [rng.gauss(0, 1) for _ in range(1024)]
    norm = sum(v * v for v in values) ** 0.5
    return [v / norm for v in values]


@pytest.fixture(scope="session", autouse=True)
def test_database():
    with psycopg.connect(ADMIN_DSN, autocommit=True) as conn:
        conn.execute("DROP DATABASE IF EXISTS movie_recommender_test")
        conn.execute("CREATE DATABASE movie_recommender_test")

    # Recreate the legacy schema first so the migration is exercised as an
    # upgrade on top of the reviewed Node schema, not just a fresh install.
    with psycopg.connect(
        "host=localhost user=farhanyaseen dbname=movie_recommender_test", autocommit=True
    ) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.execute(
            """
            CREATE TABLE movies (
              id SERIAL PRIMARY KEY,
              title TEXT NOT NULL,
              genre TEXT, year INT, director TEXT,
              description TEXT NOT NULL,
              embedding vector(1024),
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        for title, genre, year, director, description in [
            ("Inception", "Sci-Fi / Thriller", 2010, "Christopher Nolan", "A dream heist."),
            ("The Matrix", "Sci-Fi / Action", 1999, "The Wachowskis", "Reality is simulated."),
            ("Whiplash", "Drama / Music", 2014, "Damien Chazelle", "A ruthless jazz teacher."),
        ]:
            conn.execute(
                "INSERT INTO movies (title, genre, year, director, description, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (title, genre, year, director, description, str(fake_vector(description))),
            )

    subprocess.run(
        [str(API_DIR / ".venv" / "bin" / "alembic"), "upgrade", "head"],
        cwd=API_DIR,
        env={**os.environ, "DATABASE_URL": TEST_DB_URL},
        check=True,
        capture_output=True,
    )
    reset_engine()
    yield


@pytest.fixture(autouse=True)
def clean_tables(test_database):
    yield
    session_factory = get_session_factory()
    with session_factory() as db:
        from sqlalchemy import text

        db.execute(
            text(
                "TRUNCATE messages, conversations, jobs, chunks, documents, users CASCADE"
            )
        )
        db.commit()


@pytest.fixture(autouse=True)
def mock_embeddings(monkeypatch):
    """All embedding entry points produce deterministic fake vectors."""

    def fake_embed_texts(texts, input_type):
        return [fake_vector(text) for text in texts]

    def fake_embed_query(text):
        return fake_vector(text)

    monkeypatch.setattr("app.services.embedding.embed_texts", fake_embed_texts)
    monkeypatch.setattr("app.services.ingestion.embed_texts", fake_embed_texts)
    monkeypatch.setattr("app.services.retrieval.embed_query", fake_embed_query)
    monkeypatch.setattr("app.services.catalog.embed_query", fake_embed_query)
    yield


class MockProvider(GenerationProvider):
    """Scriptable provider: `turns` feed create_turn (agent rounds);
    `stream_chunks` feeds stream_text; optional exceptions."""

    def __init__(self, stream_chunks=None, turns=None, stream_error=None):
        self.stream_chunks = stream_chunks or ["Mocked ", "answer."]
        self.turns = list(turns or [])
        self.stream_error = stream_error
        self.create_calls: list[dict] = []
        self.stream_calls: list[dict] = []

    def model_name(self):
        return "mock-model"

    def stream_text(self, system, messages):
        self.stream_calls.append({"system": system, "messages": messages})
        for chunk in self.stream_chunks:
            yield chunk
        if self.stream_error is not None:
            raise self.stream_error

    def create_turn(self, system, messages, tools):
        self.create_calls.append({"system": system, "messages": messages, "tools": tools})
        if self.turns:
            return self.turns.pop(0)
        return ProviderTurn(text="Mocked final answer.")


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def use_provider(app):
    def _use(provider: GenerationProvider):
        app.dependency_overrides[get_provider] = lambda: provider
        return provider

    return _use


def create_user(email: str, password: str = "password-123") -> User:
    session_factory = get_session_factory()
    with session_factory() as db:
        user = User(email=email, password_hash=hash_password(password))
        db.add(user)
        db.commit()
        db.refresh(user)
        return user


@pytest.fixture
def user_a():
    return create_user("alice@test.local")


@pytest.fixture
def user_b():
    return create_user("bob@test.local")


def login(client, email: str, password: str = "password-123") -> dict:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def upload_and_ingest(client, headers, filename: str, text: str) -> dict:
    """Upload a document and run its ingestion job synchronously."""
    from app.services.ingestion import process_job

    response = client.post(
        "/api/documents", files={"file": (filename, text.encode(), "text/plain")}, headers=headers
    )
    assert response.status_code == 202, response.text
    body = response.json()
    if body["status"] == "pending":
        import uuid

        process_job(get_session_factory(), uuid.UUID(body["job_id"]))
    return body


def first_chunk_text(text: str) -> str:
    """The exact text of the first chunk — fake embeddings only match on
    identical text, so retrieval tests query with this."""
    from app.services.chunking import chunk_text

    return chunk_text(text, 800, 150)[0].text[:2000]


def read_sse_events(response) -> list[tuple[str, dict]]:
    import json

    events = []
    event_name = None
    for line in response.iter_lines():
        if line.startswith("event: "):
            event_name = line[len("event: ") :]
        elif line.startswith("data: ") and event_name:
            events.append((event_name, json.loads(line[len("data: ") :])))
            event_name = None
    return events
