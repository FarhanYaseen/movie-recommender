# app/services/embedding.py
# Voyage AI client: batch requests, concurrency-safe pacing, timeouts,
# bounded retries with jitter honoring Retry-After. 4xx auth/validation
# errors are never retried.

import math
import random
import threading
import time

import httpx

from ..config import get_settings
from ..errors import NotConfiguredError, UpstreamError

VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings"
MAX_RETRIES = 3


class _RateLimiter:
    """Concurrency-safe minimum-interval limiter: concurrent callers queue up
    and are released one interval apart instead of resuming together."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def acquire(self, min_interval: float) -> None:
        with self._lock:
            now = time.monotonic()
            wait = max(0.0, self._next_allowed - now)
            self._next_allowed = max(now, self._next_allowed) + min_interval
        if wait > 0:
            time.sleep(wait)


_limiter = _RateLimiter()


def _retry_delay(attempt: int, retry_after: str | None) -> float:
    if retry_after:
        try:
            value = float(retry_after)
            if 0 <= value <= 120:
                return value
        except ValueError:
            pass
    return min(30.0, (2**attempt) + random.uniform(0, 1))


def _validate(vectors: list[list[float]], expected_count: int, dimensions: int) -> None:
    if len(vectors) != expected_count:
        raise UpstreamError("Embedding provider returned a mismatched result count")
    for vector in vectors:
        if len(vector) != dimensions:
            raise UpstreamError("Embedding provider returned unexpected dimensions")
        if not all(math.isfinite(value) for value in vector):
            raise UpstreamError("Embedding provider returned non-finite values")


def embed_texts(texts: list[str], input_type: str) -> list[list[float]]:
    """Embed a batch of texts. input_type is 'document' or 'query'.
    Results are mapped back by index, validated for dimensions and finiteness."""
    if input_type not in ("document", "query"):
        raise ValueError("input_type must be 'document' or 'query'")
    if not texts:
        return []

    settings = get_settings()
    if not settings.voyage_api_key:
        raise NotConfiguredError("Embeddings are not configured (missing VOYAGE_API_KEY)")

    min_interval = 60.0 / max(settings.embedding_rpm, 1)
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        _limiter.acquire(min_interval)
        try:
            response = httpx.post(
                VOYAGE_API_URL,
                headers={"Authorization": f"Bearer {settings.voyage_api_key}"},
                json={"model": settings.voyage_model, "input": texts, "input_type": input_type},
                timeout=settings.embedding_timeout_s,
            )
        except httpx.TimeoutException as err:
            last_error = UpstreamError("Embedding provider timed out")
            if attempt < MAX_RETRIES:
                time.sleep(_retry_delay(attempt, None))
                continue
            raise last_error from err

        if response.status_code == 200:
            payload = response.json()
            try:
                rows = sorted(payload["data"], key=lambda row: row["index"])
                vectors = [row["embedding"] for row in rows]
            except (KeyError, TypeError) as err:
                raise UpstreamError("Embedding provider returned a malformed response") from err
            _validate(vectors, len(texts), settings.embedding_dimensions)
            return vectors

        if response.status_code in (401, 403):
            raise NotConfiguredError("Embedding provider rejected the configured credentials")
        if response.status_code == 429 or response.status_code >= 500:
            last_error = UpstreamError(
                "Embedding provider rate limited the request"
                if response.status_code == 429
                else "Embedding provider failed upstream"
            )
            if attempt < MAX_RETRIES:
                time.sleep(_retry_delay(attempt, response.headers.get("retry-after")))
                continue
            raise last_error
        # Other 4xx: our request is wrong — do not retry
        raise UpstreamError("Embedding provider rejected the request")

    raise last_error or UpstreamError("Embedding provider failed")


def embed_query(text: str) -> list[float]:
    return embed_texts([text], "query")[0]
