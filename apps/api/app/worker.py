# app/worker.py
# Single asyncio background task that drains pending ingestion jobs.
# Blocking DB/provider work runs in a thread so the event loop stays free.

import asyncio
import logging

from sqlalchemy import select

from .config import get_settings
from .db import get_session_factory
from .models import Job
from .services.ingestion import process_job

logger = logging.getLogger("api.worker")


def _claim_next_job_id():
    session_factory = get_session_factory()
    with session_factory() as db:
        job_id = db.execute(
            select(Job.id)
            .where(Job.status.in_(["pending"]))
            .order_by(Job.updated_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        ).scalar_one_or_none()
        return job_id


async def worker_loop(stop_event: asyncio.Event) -> None:
    settings = get_settings()
    logger.info("ingestion worker started")
    while not stop_event.is_set():
        try:
            job_id = await asyncio.to_thread(_claim_next_job_id)
            if job_id is not None:
                logger.info("processing job %s", job_id)
                await asyncio.to_thread(process_job, get_session_factory(), job_id)
                continue
        except Exception:
            logger.exception("worker iteration failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.worker_poll_interval_s)
        except asyncio.TimeoutError:
            pass
    logger.info("ingestion worker stopped")
