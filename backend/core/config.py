import logging
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # LLM
    openai_api_key: str = ""
    gemini_api_key: str = ""
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
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
    # Deep link registered in frontend/app.json for email confirmations.
    auth_email_redirect_url: str = "vyrn://auth/callback"

    # FatSecret (food search + macro lookup)
    fatsecret_client_id: str = ""
    fatsecret_client_secret: str = ""

    # ChromaDB
    chroma_persist_dir: str = "./chroma_store"
    chroma_collection_name: str = "vyrn_guardrails"

    # App
    # Accept either SECRET_KEY (canonical) or JWT_SECRET (the name the
    # README told people to use) so a .env written either way works.
    secret_key: str = Field(
        default="",
        validation_alias=AliasChoices("SECRET_KEY", "JWT_SECRET"),
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200  # 30 days
    # The scheduler is enabled only in the dedicated background worker
    # process. Keep it false in every API/web process.
    scheduler_enabled: bool = False

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


def validate_secret_key(secret_key: str | None) -> str:
    """Return a configured high-entropy JWT key or fail closed.

    A known development fallback is never accepted. Requiring at least
    32 characters does not prove entropy, so deployments should generate
    this value with Python's secrets module and keep it stable.
    """
    value = (secret_key or "").strip()
    if value == "dev-secret-key-change-in-production" or len(value) < 32:
        raise RuntimeError(
            "SECRET_KEY is not configured securely. Set a unique random "
            "value of at least 32 characters before starting VYRN."
        )
    return value


def validate_runtime_security_settings(settings: Settings | None = None) -> None:
    """Fail application startup when signing configuration is unsafe."""
    active_settings = settings or get_settings()
    validate_secret_key(active_settings.secret_key)
