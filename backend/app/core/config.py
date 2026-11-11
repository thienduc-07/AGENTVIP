import os
from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

def _resolve_portable_db_url() -> str:
    env_db = os.getenv("DATABASE_URL")
    if env_db:
        return env_db
    local_db = BASE_DIR / "agency.db"
    is_serverless_or_readonly = bool(
        os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME") or not os.access(str(BASE_DIR), os.W_OK)
    )
    if is_serverless_or_readonly:
        import tempfile
        import shutil
        tmp_db = Path(tempfile.gettempdir()) / "agency.db"
        if local_db.exists() and not tmp_db.exists():
            try:
                shutil.copy2(str(local_db), str(tmp_db))
            except Exception:
                pass
        return f"sqlite:///{tmp_db}"
    return f"sqlite:///{local_db}"

def _resolve_portable_sandbox_dir() -> Path:
    env_sandbox = os.getenv("WORKSPACE_SANDBOX_DIR")
    if env_sandbox:
        return Path(env_sandbox)
    if os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME") or not os.access(str(BASE_DIR), os.W_OK):
        import tempfile
        return Path(tempfile.gettempdir()) / "provipagent_sandbox"
    return BASE_DIR / "workspace_sandbox"

class Settings(BaseSettings):
    APP_NAME: str = "AI Agency — Autonomous Business Headquarters"
    VERSION: str = "1.0.0"
    APP_ENV: str = "development"
    DEBUG: bool = True
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = _resolve_portable_db_url()

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
    SECRET_KEY: Optional[str] = "cfb6ecffda4b1877a926f31e206d1bbf4f57855c35aed8f04bee248e4dbc746f"

    # Workspace & File Paths
    WORKSPACE_ROOT: Path = BASE_DIR
    SANDBOX_DIR: Path = _resolve_portable_sandbox_dir()

    # LLM Provider Configuration
    LLM_PROVIDER: str = "deterministic"  # deterministic, openai, groq, openrouter, gemini, ollama
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_API_KEY: Optional[str] = None
    LLM_BASE_URL: Optional[str] = None
    LLM_TIMEOUT_SECONDS: int = 60
    LLM_MAX_RETRIES: int = 2
    LLM_RETRY_BASE_DELAY_SECONDS: float = 0.5

    # Provider-Specific Fallback Environment Variables
    OPENAI_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    OPENROUTER_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    OLLAMA_BASE_URL: Optional[str] = None
    OLLAMA_MODEL: Optional[str] = None

    # Phase 3.3.3.8 & 3.3.3.10 — Hybrid LLM Intelligence & Zero-Cost Deployment
    LLM_ROUTING_MODE: str = "hybrid"  # "single" (uses LLM_PROVIDER) or "hybrid" (local Ollama + cloud OpenRouter)
    LLM_LOCAL_PROVIDER: str = "ollama"
    LLM_LOCAL_BASE_URL: str = "http://localhost:11434"
    LLM_LOCAL_MODEL: str = "qwen2.5:3b"
    LLM_CLOUD_PROVIDER: str = "openrouter"
    LLM_CLOUD_MODEL: str = "google/gemma-4-31b-it:free"
    LLM_FREE_FALLBACK_MODELS: str = (
        "nvidia/nemotron-3.5-super-vl:free,dots-studio/dots-3-note-preview:free,nvidia/nemotron-3.5-lightning:free"
    )
    LLM_ALLOW_CLOUD_FALLBACK: bool = False
    LLM_ZERO_COST_POLICY: bool = True

    # Cloud Cost Governance, Rate Limit & Provider Health Monitor Settings
    MAX_TASK_CLOUD_COST_USD: float = 0.10
    MAX_ORGANIZATION_DAILY_CLOUD_COST_USD: float = 1.00
    MAX_ORGANIZATION_MONTHLY_CLOUD_COST_USD: float = 20.00
    MAX_TASK_CLOUD_REQUESTS: int = 30
    MAX_ORGANIZATION_DAILY_CLOUD_REQUESTS: int = 200
    LLM_MAX_CONCURRENT_REQUESTS: int = 2
    MAX_TOKENS_PER_REQUEST: int = 131072
    LLM_HEALTH_CHECK_INTERVAL_SECONDS: float = 30.0
    LLM_HEALTH_CHECK_TIMEOUT_SECONDS: float = 5.0
    LLM_HEALTH_FAILURE_THRESHOLD: int = 3

    # Runtime Execution Bounds & Task Cost/Duration Guards (Phase 3.3.3.6)
    MAX_EXECUTION_ITERATIONS: int = 10
    MAX_TOOL_CALLS: int = 15
    MAX_PLAN_STEPS: int = 8
    MAX_FILE_READ_BYTES: int = 100 * 1024  # 100 KB limit to prevent context explosion
    MAX_TASK_TOKENS: int = 524288
    MAX_TASK_COST_USD: float = 0.50
    MAX_TASK_EXECUTION_SECONDS: float = 300.0

    # Task Dispatcher & Worker
    DISPATCHER_POLL_INTERVAL: float = 1.0  # seconds
    DISPATCHER_ENABLED: bool = True
    MAX_WORKFLOW_CONCURRENCY: int = 4

    # Autonomous CEO Supervisory Heartbeat (Phase 3.3.3.4)
    # Safely disabled by default in development and testing environments
    CEO_HEARTBEAT_ENABLED: bool = False
    CEO_HEARTBEAT_AGENT_ID: str = "agent-exec-ceo"
    CEO_HEARTBEAT_INTERVAL_SECONDS: float = 60.0
    CEO_HEARTBEAT_TIMEOUT_SECONDS: float = 25.0
    CEO_HEARTBEAT_STALLED_TASK_THRESHOLD_SECONDS: float = 300.0
    CEO_HEARTBEAT_OVERDUE_TASK_THRESHOLD_SECONDS: float = 900.0
    CEO_HEARTBEAT_MAX_TOKENS_PER_RUN: int = 2000
    CEO_HEARTBEAT_MAX_COST_USD_PER_RUN: float = 0.05
    CEO_HEARTBEAT_DAILY_TOKEN_BUDGET: int = 100000
    CEO_HEARTBEAT_DAILY_COST_BUDGET_USD: float = 2.00
    CEO_HEARTBEAT_REQUIRE_APPROVAL_FOR_REASSIGNMENT: bool = True

    @property
    def free_fallback_models_list(self) -> List[str]:
        raw = self.LLM_FREE_FALLBACK_MODELS or ""
        return [m.strip() for m in raw.split(",") if m.strip()]

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

# Ensure sandbox directory exists safely
try:
    os.makedirs(settings.SANDBOX_DIR, exist_ok=True)
except Exception:
    import tempfile
    settings.SANDBOX_DIR = Path(tempfile.gettempdir()) / "provipagent_sandbox"
    try:
        os.makedirs(settings.SANDBOX_DIR, exist_ok=True)
    except Exception:
        pass
