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

# Ensure sandbox directory exists
os.makedirs(settings.SANDBOX_DIR, exist_ok=True)
