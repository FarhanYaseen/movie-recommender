# app/routers/search.py

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import User
from ..schemas import SearchHit, SearchRequest, SearchResponse
from ..services.retrieval import search_chunks

router = APIRouter(prefix="/api/search", tags=["search"])

SNIPPET_LENGTH = 240


@router.post("", response_model=SearchResponse)
def search(
    body: SearchRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchResponse:
    chunks = search_chunks(db, user.id, body.query, body.limit, body.document_ids)
    return SearchResponse(
        query=body.query,
        data=[
            SearchHit(
                chunk_id=chunk.chunk_id,
                document_id=chunk.document_id,
                document_title=chunk.document_title,
                ordinal=chunk.ordinal,
                score=round(chunk.score, 4),
                snippet=chunk.text[:SNIPPET_LENGTH],
            )
            for chunk in chunks
        ],
    )
