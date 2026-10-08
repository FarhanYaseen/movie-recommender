# app/services/chunking.py
# Deterministic character-based chunking with stable offsets.
# Same input + same settings => identical chunks (ordinals, offsets, hashes).

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class TextChunk:
    ordinal: int
    start_offset: int
    end_offset: int  # exclusive
    text: str
    content_hash: str


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[TextChunk]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if chunk_overlap < 0 or chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be in [0, chunk_size)")

    step = chunk_size - chunk_overlap
    chunks: list[TextChunk] = []
    ordinal = 0
    start = 0
    length = len(text)

    while start < length:
        end = min(start + chunk_size, length)
        piece = text[start:end]
        if piece.strip():
            chunks.append(
                TextChunk(
                    ordinal=ordinal,
                    start_offset=start,
                    end_offset=end,
                    text=piece,
                    content_hash=_hash(piece),
                )
            )
            ordinal += 1
        if end >= length:
            break
        start += step

    return chunks
