import logging
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # LLM
    openai_api_key: str = ""
    gemini_api_key: str = ""
    groq_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("GROQ_API_KEY", "GROQ_KEY"),
    )
    groq_model: str = "llama-3.3-70b-versatile"
    llm_provider: str = "groq"  # openai | gemini | groq

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    # Accept either SUPABASE_SERVICE_KEY (canonical) or SUPABASE_KEY (the
    # name the README told people to use) so a .env written either way works.
    supabase_service_key: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_SERVICE_KEY", "SUPABASE_KEY"),
    )

    # ChromaDB
    chroma_persist_dir: str = "./chroma_store"
    chroma_collection_name: str = "repmind_guardrails"

    # App
    # Accept either SECRET_KEY (canonical) or JWT_SECRET (the name the
    # README told people to use) so a .env written either way works.
    secret_key: str = Field(
        default="dev-secret-key-change-in-production",
        validation_alias=AliasChoices("SECRET_KEY", "JWT_SECRET"),
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200  # 30 days — long-lived so users
    # aren't forced to log in repeatedly. Security still holds because the
    # token is invalidated entirely if SECRET_KEY is ever rotated, and the
    # ORPHANED_SESSION check in core/security.py catches stale tokens
    # pointing at deleted accounts.

    # CORS
    # Dev tooling (Expo Metro, `npx serve`) frequently falls back to a
    # random port when its default is already occupied — this happened
    # repeatedly in practice (port 3000 occupied -> served on 51559,
    # 57262, etc), and a hardcoded port list silently 400s every preflight
    # from those fallback ports with no visible error on the frontend
    # (CORS failures never reach your app code, they're blocked by the
    # browser before your fetch/axios call ever fires).
    # allow_origin_regex in main.py (see comment there) handles the
    # "any localhost port" case; this list covers the common explicit ones.
    allowed_origins: str = "http://localhost:3000,http://localhost:8081,http://localhost:5173,http://localhost:19006"

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