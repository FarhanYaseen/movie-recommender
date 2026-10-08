# app/config.py
# Centralized settings, read from environment (names frozen in docs/contracts/ai-api.md)

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://farhanyaseen@localhost:5432/movie_recommender"

    jwt_secret: str = "dev-only-secret-change-me"
    jwt_expires_min: int = 60

    voyage_api_key: str = ""
    voyage_model: str = "voyage-3"
    embedding_dimensions: int = 1024
    embedding_rpm: int = 3
    embedding_timeout_s: int = 30

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5-5"

    chunk_size: int = 800
    chunk_overlap: int = 150
    max_upload_bytes: int = 2_097_152

    agent_max_tool_rounds: int = 3
    chat_max_output_tokens: int = 1024
    chat_timeout_s: int = 120
    user_daily_message_limit: int = 200

    retrieval_top_k: int = 8
    retrieval_similarity_floor: float = 0.25
    history_max_messages: int = 20

    enable_demo_seed: bool = False
    demo_user_a_email: str = "alice@example.com"
    demo_user_a_password: str = ""
    demo_user_b_email: str = "bob@example.com"
    demo_user_b_password: str = ""

    worker_enabled: bool = True
    worker_poll_interval_s: float = 1.0
    embedding_batch_size: int = 32


@lru_cache
def get_settings() -> Settings:
    return Settings()
