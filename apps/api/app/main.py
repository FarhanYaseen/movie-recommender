# app/main.py
# FastAPI application factory + lifespan (demo seed, ingestion worker).

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import seed_demo_users
from .config import INSECURE_JWT_DEFAULT, get_settings
from .db import get_session_factory
from .middleware.request_context import RequestIdMiddleware, install_error_handlers
from .routers import auth, chat, documents, health, jobs, search
from .worker import worker_loop

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.jwt_secret == INSECURE_JWT_DEFAULT:
        if settings.app_env == "production":
            raise RuntimeError(
                "JWT_SECRET is the insecure default; set a real secret before "
                "running with APP_ENV=production (openssl rand -hex 32)"
            )
        logger.warning("JWT_SECRET is the insecure dev default — fine locally, never in production")
    try:
        with get_session_factory()() as db:
            seed_demo_users(db)
    except Exception:
        # DB may be unavailable at boot; readiness reports it, the app still starts
        logger.warning("demo seed skipped: database unavailable at startup")

    stop_event = asyncio.Event()
    worker_task = None
    if settings.worker_enabled:
        worker_task = asyncio.create_task(worker_loop(stop_event))
    yield
    stop_event.set()
    if worker_task is not None:
        await worker_task


def create_app() -> FastAPI:
    app = FastAPI(title="Movie RAG API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:3001"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(documents.router)
    app.include_router(jobs.router)
    app.include_router(search.router)
    app.include_router(chat.router)
    return app


app = create_app()
