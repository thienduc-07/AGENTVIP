import os
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent.parent
WORKSPACE_SANDBOX = BASE_DIR / "workspace_sandbox"
WORKSPACE_SANDBOX.mkdir(exist_ok=True)

class Settings(BaseSettings):
    APP_NAME: str = "AI Agency — Autonomous Business Headquarters"
    VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'agency.db'}"
    
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
