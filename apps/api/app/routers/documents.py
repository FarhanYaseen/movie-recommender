# app/routers/documents.py

import uuid

from fastapi import APIRouter, Depends, Form, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..errors import NotFoundError
from ..models import Chunk, Document, User
from ..schemas import ChunkOut, DocumentListResponse, DocumentOut, UploadResponse
from ..services.ingestion import create_document_with_job, validate_upload

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("", response_model=UploadResponse, status_code=202)
async def upload_document(
    response: Response,
    file: UploadFile,
    title: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UploadResponse:
    content = await file.read()
    source_name, text = validate_upload(file.filename, content)
    document, job, is_duplicate = create_document_with_job(db, user, source_name, title, text)
    db.commit()
    if is_duplicate:
        # Contract: idempotent duplicates return 200, not 202 (nothing was accepted)
        response.status_code = 200
    return UploadResponse(
        document_id=document.id,
        job_id=job.id if job else None,
        status="duplicate" if is_duplicate else "pending",
    )


@router.get("", response_model=DocumentListResponse)
def list_documents(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DocumentListResponse:
    rows = db.execute(
        select(Document, func.count(Chunk.id))
        .outerjoin(Chunk, Chunk.document_id == Document.id)
        .where(Document.user_id == user.id)
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    ).all()
    return DocumentListResponse(
        data=[
            DocumentOut(
                id=document.id,
                title=document.title,
                source_name=document.source_name,
                status=document.status,
                chunk_count=count,
                created_at=document.created_at.isoformat(),
            )
            for document, count in rows
        ]
    )


@router.get("/{document_id}/chunks/{chunk_id}", response_model=ChunkOut)
def get_chunk(
    document_id: uuid.UUID,
    chunk_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChunkOut:
    row = db.execute(
        select(Chunk, Document.title)
        .join(Document, Document.id == Chunk.document_id)
        .where(
            Chunk.id == chunk_id,
            Chunk.document_id == document_id,
            Document.user_id == user.id,  # owner scope
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Chunk not found")
    chunk, document_title = row
    return ChunkOut(
        id=chunk.id,
        document_id=chunk.document_id,
        document_title=document_title,
        ordinal=chunk.ordinal,
        start_offset=chunk.start_offset,
        end_offset=chunk.end_offset,
        text=chunk.text,
    )
