"""
Vercel FastAPI Entrypoint for Backend Service
"""
import sys
import os

# Ensure current backend directory and parent repo root are on sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
repo_root = os.path.abspath(os.path.join(backend_dir, ".."))

if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

# Re-export FastAPI application instance
from backend.app.main import app

__all__ = ["app"]

