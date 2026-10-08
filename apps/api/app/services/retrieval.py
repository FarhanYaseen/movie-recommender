# app/services/retrieval.py
# Owner-scoped vector retrieval. The ownership filter lives in the SQL WHERE
# clause and user identity always comes from the authenticated token.

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ValidationApiError
from ..models import Chunk, Document
from .embedding import embed_query


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    ordinal: int
    score: float
    text: str


def validate_owned_document_ids(
    db: Session, user_id: uuid.UUID, document_ids: list[uuid.UUID] | None
) -> list[uuid.UUID] | None:
    if not document_ids:
        return None
    owned = set(
        db.execute(
            select(Document.id).where(
                Document.user_id == user_id, Document.id.in_(document_ids)
            )
        ).scalars()
    )
    missing = [str(doc_id) for doc_id in document_ids if doc_id not in owned]
    if missing:
        raise ValidationApiError("document_ids contains documents you do not own")
    return list(owned)


def search_chunks(
    db: Session,
    user_id: uuid.UUID,
    query: str,
    limit: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[RetrievedChunk]:
    owned_ids = validate_owned_document_ids(db, user_id, document_ids)
    query_vector = embed_query(query)

    distance = Chunk.embedding.cosine_distance(query_vector)
    statement = (
        select(
            Chunk.id,
            Chunk.document_id,
            Document.title,
            Chunk.ordinal,
            (1 - distance).label("score"),
            Chunk.text,
        )
        .join(Document, Document.id == Chunk.document_id)
        .where(
            Document.user_id == user_id,  # ownership filter: always from the token
            Document.status == "ready",
            Chunk.embedding.is_not(None),
        )
        .order_by(distance)
        .limit(limit)
    )
    if owned_ids is not None:
        statement = statement.where(Document.id.in_(owned_ids))

    rows = db.execute(statement).all()
    return [
        RetrievedChunk(
            chunk_id=row[0],
            document_id=row[1],
            document_title=row[2],
            ordinal=row[3],
            score=float(row[4]),
            text=row[5],
        )
        for row in rows
    ]
