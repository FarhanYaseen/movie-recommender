# tests/test_embedding_client.py
# Unit tests for the Voyage client's retry and error-mapping behavior.
# No network: httpx.post is monkeypatched; sleeps and pacing are disabled.

import httpx
import pytest

from app.errors import NotConfiguredError, UpstreamError
from app.services import embedding

# The conftest autouse fixture replaces embedding.embed_texts with a fake for
# integration tests; capture the real client at import time (before fixtures run)
real_embed_texts = embedding.embed_texts


@pytest.fixture(autouse=True)
def fast_client(monkeypatch):
    monkeypatch.setattr(embedding.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(embedding._limiter, "acquire", lambda _interval: None)
    monkeypatch.setattr(embedding.get_settings().__class__, "voyage_api_key", "test-key", raising=False)


def _ok_response(count):
    vector = [0.1] * embedding.get_settings().embedding_dimensions
    return httpx.Response(
        200,
        json={"data": [{"index": i, "embedding": vector} for i in range(count)]},
        request=httpx.Request("POST", embedding.VOYAGE_API_URL),
    )


def test_connect_error_is_retried_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake_post(*_args, **_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("nodename nor servname provided, or not known")
        return _ok_response(1)

    monkeypatch.setattr(embedding.httpx, "post", fake_post)
    vectors = real_embed_texts(["hello"], "query")
    assert len(vectors) == 1
    assert calls["n"] == 2


def test_connect_error_exhausting_retries_maps_to_upstream_error(monkeypatch):
    def fake_post(*_args, **_kwargs):
        raise httpx.ConnectError("nodename nor servname provided, or not known")

    monkeypatch.setattr(embedding.httpx, "post", fake_post)
    with pytest.raises(UpstreamError):  # 502 UPSTREAM_ERROR, never a raw 500
        real_embed_texts(["hello"], "query")


def test_429_honors_retry_after_then_succeeds(monkeypatch):
    calls = {"n": 0}
    sleeps = []
    monkeypatch.setattr(embedding.time, "sleep", lambda seconds: sleeps.append(seconds))

    def fake_post(*_args, **_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                429,
                headers={"retry-after": "7"},
                request=httpx.Request("POST", embedding.VOYAGE_API_URL),
            )
        return _ok_response(1)

    monkeypatch.setattr(embedding.httpx, "post", fake_post)
    vectors = real_embed_texts(["hello"], "query")
    assert len(vectors) == 1
    assert 7.0 in sleeps  # Retry-After honored


def test_auth_errors_are_not_retried(monkeypatch):
    calls = {"n": 0}

    def fake_post(*_args, **_kwargs):
        calls["n"] += 1
        return httpx.Response(401, request=httpx.Request("POST", embedding.VOYAGE_API_URL))

    monkeypatch.setattr(embedding.httpx, "post", fake_post)
    with pytest.raises(NotConfiguredError):
        real_embed_texts(["hello"], "query")
    assert calls["n"] == 1
