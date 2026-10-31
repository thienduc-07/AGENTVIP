import os
from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

class Settings(BaseSettings):
    APP_NAME: str = "AI Agency — Autonomous Business Headquarters"
    VERSION: str = "1.0.0"
    APP_ENV: str = "development"
    DEBUG: bool = True
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'agency.db'}"

    # Validation Limits
    MAX_TASK_TITLE_LENGTH: int = 120
    MAX_TASK_DESC_LENGTH: int = 4000

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ]

    # Authentication & Cryptographic Signing
    SECRET_KEY: Optional[str] = None

    # Workspace & File Paths
    WORKSPACE_ROOT: Path = BASE_DIR
    SANDBOX_DIR: Path = BASE_DIR / "workspace_sandbox"

    # LLM Provider Configuration
    LLM_PROVIDER: str = "deterministic"  # deterministic, openai, ollama, gemini
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_API_KEY: Optional[str] = None
    LLM_BASE_URL: Optional[str] = None
    LLM_TIMEOUT_SECONDS: int = 60

    # Runtime Execution Bounds
    MAX_EXECUTION_ITERATIONS: int = 10
    MAX_TOOL_CALLS: int = 15
    MAX_PLAN_STEPS: int = 8
    MAX_FILE_READ_BYTES: int = 100 * 1024  # 100 KB limit to prevent context explosion

    # Task Dispatcher & Worker
    DISPATCHER_POLL_INTERVAL: float = 1.0  # seconds
    DISPATCHER_ENABLED: bool = True

    model_config = {
        "env_file": ".env",
        "extra": "ignore"
    }

settings = Settings()

FORBIDDEN_DEFAULT_SECRETS = {
    "secret",
    "secret_key",
    "secretkey",
    "provipagent-secret",
    "provipagent-master-production-secret-key-32b",
    "change_me",
    "changeme",
    "development",
    "dev_secret",
    "supersecret",
    "jwtsecret",
    "default",
    "12345678901234567890123456789012",
    "your-32-character-secret-key-goes-here",
    "your-secret-key-here-min-32-chars-long",
    "replace_with_a_secure_random_32_byte_secret",
    "replace_with_a_secure_random_32_byte_secret_via_openssl",
}

def validate_signing_secret(candidate: Optional[str] = None) -> str:
    """
    Validates that the JWT signing secret is present, non-empty,
    not equal to a known insecure default, and at least 32 bytes in length.
    Never exposes or logs the actual secret value.
    """
    raw = candidate if candidate is not None else (os.environ.get("SECRET_KEY") or settings.SECRET_KEY)
    if not raw or not str(raw).strip():
        raise ValueError("Startup aborted: SECRET_KEY is missing or empty. A cryptographically secure 32+ byte key is required.")
    clean = str(raw).strip()
    if clean.lower() in FORBIDDEN_DEFAULT_SECRETS:
        raise ValueError("Startup aborted: Insecure default or development SECRET_KEY detected. Provide a secure random secret.")
    if len(clean.encode("utf-8")) < 32:
        raise ValueError("Startup aborted: SECRET_KEY is too short (minimum 32 bytes required).")
    return clean

# Ensure sandbox directory exists
os.makedirs(settings.SANDBOX_DIR, exist_ok=True)
