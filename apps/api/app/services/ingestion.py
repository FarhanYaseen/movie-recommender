# app/services/ingestion.py
# Upload validation, idempotent document creation, and job processing.
# Chunk rows are created at upload time (embedding NULL); the worker embeds
# them in batches. Upserts on (document_id, ordinal) keep retries idempotent.

import hashlib
import re
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..config import get_settings
from ..errors import ValidationApiError
from ..models import Chunk, Document, Job, User
from .chunking import chunk_text
from .embedding import embed_texts

ALLOWED_EXTENSIONS = (".txt", ".md")
_FILENAME_SAFE = re.compile(r"^[\w.\- ()\[\]]{1,255}$")


def validate_upload(filename: str | None, content: bytes) -> tuple[str, str]:
    """Returns (safe_source_name, decoded_text) or raises ValidationApiError."""
    settings = get_settings()
    if not filename:
        raise ValidationApiError("A filename is required")
    name = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if not _FILENAME_SAFE.match(name):
        raise ValidationApiError("Filename contains unsupported characters")
    if not name.lower().endswith(ALLOWED_EXTENSIONS):
        raise ValidationApiError("Only UTF-8 .txt and .md files are accepted")
    if len(content) == 0:
        raise ValidationApiError("The file is empty")
    if len(content) > settings.max_upload_bytes:
        raise ValidationApiError(
            f"File exceeds the {settings.max_upload_bytes} byte limit"
        )
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise ValidationApiError("File must be valid UTF-8 text")
    if not text.strip():
        raise ValidationApiError("The file contains no text")
    return name, text


def create_document_with_job(
    db: Session, user: User, source_name: str, title: str | None, text: str
) -> tuple[Document, Job, bool]:
    """Create document + chunk rows + job, or return the existing document for
    identical content (idempotent). Returns (document, job, is_duplicate)."""
    settings = get_settings()
    checksum = hashlib.sha256(text.encode("utf-8")).hexdigest()

    existing = db.execute(
        select(Document).where(Document.user_id == user.id, Document.checksum == checksum)
    ).scalar_one_or_none()
    if existing is not None:
        job = db.execute(
            select(Job).where(Job.document_id == existing.id).order_by(Job.updated_at.desc())
        ).scalars().first()
        return existing, job, True

    chunks = chunk_text(text, settings.chunk_size, settings.chunk_overlap)
    if not chunks:
        raise ValidationApiError("The file contains no usable text")

    document = Document(
        user_id=user.id,
        title=(title or source_name).strip()[:500],
        source_name=source_name,
        checksum=checksum,
        status="pending",
        embedding_model=settings.voyage_model,
        embedding_dimensions=settings.embedding_dimensions,
    )
    db.add(document)
    db.flush()

    for chunk in chunks:
        db.add(
            Chunk(
                document_id=document.id,
                ordinal=chunk.ordinal,
                start_offset=chunk.start_offset,
                end_offset=chunk.end_offset,
                text=chunk.text,
                content_hash=chunk.content_hash,
            )
        )

    job = Job(
        document_id=document.id,
        user_id=user.id,
        status="pending",
        completed_chunks=0,
        total_chunks=len(chunks),
    )
    db.add(job)
    db.flush()
    return document, job, False


def reingest_chunks(db: Session, document: Document, text: str) -> int:
    """Deterministically re-chunk and upsert; unchanged chunks are untouched.
    Used when a job is retried after partial ingestion. Returns chunk count."""
    settings = get_settings()
    chunks = chunk_text(text, settings.chunk_size, settings.chunk_overlap)
    for chunk in chunks:
        statement = (
            pg_insert(Chunk)
            .values(
                id=uuid.uuid4(),
                document_id=document.id,
                ordinal=chunk.ordinal,
                start_offset=chunk.start_offset,
                end_offset=chunk.end_offset,
                text=chunk.text,
                content_hash=chunk.content_hash,
            )
            .on_conflict_do_nothing(constraint="uq_chunks_document_ordinal")
        )
        db.execute(statement)
    return len(chunks)


def process_job(session_factory, job_id: uuid.UUID) -> None:
    """Embed all pending chunks for one job. Safe to call again after a crash:
    only chunks with embedding IS NULL are embedded, and progress is persisted
    after each batch."""
    settings = get_settings()

    with session_factory() as db:
        job = db.get(Job, job_id)
        if job is None or job.status in ("completed",):
            return
        document = db.get(Document, job.document_id)
        if document is None:
            job.status = "failed"
            job.error = "Document no longer exists"
            db.commit()
            return

        job.status = "processing"
        document.status = "processing"
        total = db.execute(
            select(Chunk.id).where(Chunk.document_id == document.id)
        ).all()
        done = db.execute(
            select(Chunk.id).where(
                Chunk.document_id == document.id, Chunk.embedding.is_not(None)
            )
        ).all()
        job.total_chunks = len(total)
        job.completed_chunks = len(done)
        db.commit()

        try:
            while True:
                batch = (
                    db.execute(
                        select(Chunk)
                        .where(Chunk.document_id == document.id, Chunk.embedding.is_(None))
                        .order_by(Chunk.ordinal)
                        .limit(settings.embedding_batch_size)
                    )
                    .scalars()
                    .all()
                )
                if not batch:
                    break
                vectors = embed_texts([chunk.text for chunk in batch], "document")
                for chunk, vector in zip(batch, vectors):
                    chunk.embedding = vector
                job.completed_chunks += len(batch)
                db.commit()

            job.status = "completed"
            document.status = "ready"
            db.commit()
        except Exception as err:  # noqa: BLE001 - job failures must be recorded, not raised
            db.rollback()
            job = db.get(Job, job_id)
            document = db.get(Document, job.document_id)
            job.status = "failed"
            job.error = "Ingestion failed while generating embeddings"
            document.status = "failed"
            db.commit()
            import logging

            logging.getLogger("api.worker").error("job %s failed: %s", job_id, err)
