import os

from alembic import context
from sqlalchemy import create_engine

from app.db import _normalize_url
from app.models import Base

config = context.config
target_metadata = Base.metadata


def _database_url() -> str:
    url = os.environ.get(
        "DATABASE_URL", "postgresql://farhanyaseen@localhost:5432/movie_recommender"
    )
    return _normalize_url(url)


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_database_url())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
