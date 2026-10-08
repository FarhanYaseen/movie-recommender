# app/services/catalog.py
# Read-only access to the legacy movies catalog (public data). The table is
# owned by the Node API's migrations; only parameterized raw SQL is used here.

import uuid as _uuid  # noqa: F401  (kept for symmetry with other services)

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from .embedding import embed_query


def search_catalog(
    db: Session,
    query: str,
    limit: int,
    genre: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
) -> list[dict]:
    vector = embed_query(query)
    clauses = ["embedding IS NOT NULL"]
    params: dict = {"vec": str(vector), "lim": limit}
    if genre:
        clauses.append("genre ILIKE :genre")
        params["genre"] = f"%{genre}%"
    if year_from is not None:
        clauses.append("year >= :year_from")
        params["year_from"] = year_from
    if year_to is not None:
        clauses.append("year <= :year_to")
        params["year_to"] = year_to

    rows = db.execute(
        sql_text(
            f"""
            SELECT id, title, genre, year, director, description,
                   1 - (embedding <=> CAST(:vec AS vector)) AS similarity
            FROM movies
            WHERE {" AND ".join(clauses)}
            ORDER BY embedding <=> CAST(:vec AS vector)
            LIMIT :lim
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


def get_movie_details(db: Session, movie_id: int) -> dict | None:
    row = db.execute(
        sql_text(
            "SELECT id, title, genre, year, director, description "
            "FROM movies WHERE id = :movie_id"
        ),
        {"movie_id": movie_id},
    ).mappings().one_or_none()
    return dict(row) if row else None
