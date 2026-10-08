# app/routers/jobs.py

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..errors import NotFoundError
from ..models import Job, User
from ..schemas import JobOut

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobOut)
def get_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JobOut:
    job = db.get(Job, job_id)
    if job is None or job.user_id != user.id:  # owner scope
        raise NotFoundError("Job not found")
    return JobOut(
        id=job.id,
        document_id=job.document_id,
        status=job.status,
        completed_chunks=job.completed_chunks,
        total_chunks=job.total_chunks,
        error=job.error,
    )
