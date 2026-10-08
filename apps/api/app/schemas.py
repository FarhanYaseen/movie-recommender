# app/schemas.py
# Request/response schemas per docs/contracts/ai-api.md

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    id: uuid.UUID
    email: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut


class UploadResponse(BaseModel):
    document_id: uuid.UUID
    job_id: uuid.UUID
    status: Literal["pending", "duplicate"]


class DocumentOut(BaseModel):
    id: uuid.UUID
    title: str
    source_name: str
    status: str
    chunk_count: int
    created_at: str


class DocumentListResponse(BaseModel):
    data: list[DocumentOut]


class JobOut(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    status: str
    completed_chunks: int
    total_chunks: int | None
    error: str | None


class ChunkOut(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    ordinal: int
    start_offset: int
    end_offset: int
    text: str


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    limit: int = Field(default=8, ge=1, le=20)
    document_ids: list[uuid.UUID] | None = None


class SearchHit(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    ordinal: int
    score: float
    snippet: str


class SearchResponse(BaseModel):
    query: str
    data: list[SearchHit]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None
    mode: Literal["rag", "agent"] = "rag"
