import os
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent.parent

def _resolve_sandbox() -> Path:
    env_dir = os.getenv("WORKSPACE_SANDBOX_DIR")
    if env_dir:
        return Path(env_dir)
    if os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME") or not os.access(str(BASE_DIR), os.W_OK):
        import tempfile
        return Path(tempfile.gettempdir()) / "provipagent_sandbox"
    return BASE_DIR / "workspace_sandbox"

WORKSPACE_SANDBOX = _resolve_sandbox()
try:
    WORKSPACE_SANDBOX.mkdir(parents=True, exist_ok=True)
except Exception:
    import tempfile
    WORKSPACE_SANDBOX = Path(tempfile.gettempdir()) / "provipagent_sandbox"
    try:
        WORKSPACE_SANDBOX.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

def _resolve_db_url() -> str:
    env_db = os.getenv("DATABASE_URL")
    if env_db:
        return env_db
    local_db = BASE_DIR / "agency.db"
    if os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME") or not os.access(str(BASE_DIR), os.W_OK):
        import tempfile
        return f"sqlite:///{Path(tempfile.gettempdir()) / 'agency.db'}"
    return f"sqlite:///{local_db}"

class Settings(BaseSettings):
    APP_NAME: str = "AI Agency — Autonomous Business Headquarters"
    VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    # Database
    DATABASE_URL: str = _resolve_db_url()
    
    # Sandbox restrictions
    SANDBOX_DIR: Path = WORKSPACE_SANDBOX
    MAX_EXECUTION_TIME_SECONDS: int = 15
    MAX_FILE_SIZE_BYTES: int = 1_000_000  # 1MB limit for safe sandbox
    
    # Model Providers (optional, budget = 0 out of the box)
    DEFAULT_PROVIDER: str = "deterministic" # 'deterministic', 'gemini', 'openai', 'ollama'
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    
    # CORS
    CORS_ORIGINS: list = ["http://localhost:3000", "http://127.0.0.1:3000", "*"]

    model_config = {
        "env_file": ".env",
        "extra": "ignore"
    }

settings = Settings()
