import logging
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # LLM
    openai_api_key: str = ""
    gemini_api_key: str = ""
    llm_provider: str = "gemini"  # openai | gemini

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""

    # ChromaDB
    chroma_persist_dir: str = "./chroma_store"
    chroma_collection_name: str = "repmind_guardrails"

    # App
    secret_key: str = "dev-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 10080  # 7 days

    # CORS
    allowed_origins: str = "http://localhost:3000,http://localhost:8081,http://localhost:5173"

    # Logging
    log_level: str = "INFO"

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def setup_logging():
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )