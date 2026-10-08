# app/routers/health.py
# Liveness/readiness; never includes secrets or private content.

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text as sql_text

from ..db import get_engine

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
def live() -> dict:
    return {"status": "ok"}


@router.get("/ready")
def ready():
    try:
        with get_engine().connect() as connection:
            connection.execute(sql_text("SELECT 1"))
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not_ready"})
