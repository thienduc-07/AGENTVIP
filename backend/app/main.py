import json
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import engine, Base, SessionLocal, get_db
from backend.app.core.errors import setup_exception_handlers
from backend.app.api.v1.router import api_v1_router
from backend.app.scripts.seed import seed_database
from backend.app.websocket_manager import ws_manager
from backend.app.models.agent import AgentModel
from backend.app.routers import system
from backend.app.agent_runtime import agent_runtime

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("agency.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    # Fail-secure startup check: Validate cryptographic signing secret immediately
    from backend.app.core.config import validate_signing_secret
    validate_signing_secret()

    ws_manager.main_loop = asyncio.get_running_loop()
    logger.info("Initializing database schema...")
    Base.metadata.create_all(bind=engine)
    
    # Run idempotent seed & runtime startup
    db = SessionLocal()
    try:
        seed_database()
        logger.info("Corporate seed verified successfully.")
        
        # Initialize runtime and background task dispatcher
        if settings.DISPATCHER_ENABLED:
            agent_runtime.on_startup(db)
    except Exception as e:
        logger.error(f"Error initializing runtime on startup: {e}")
    finally:
        db.close()
        
    yield
    logger.info("AI Agency API shutting down...")
    await agent_runtime.on_shutdown()
    logger.info("Shutdown complete.")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Setup standardized error handlers
setup_exception_handlers(app)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Root Health Check
@app.get("/health", tags=["Health"])
def root_health():
    return {
        "status": "ok",
        "service": "ai-agent-city-api"
    }

# Mount /api/v1 router
app.include_router(api_v1_router)

# Mount system monitoring router
app.include_router(system.router)

# Realtime WebSocket Handlers
async def _handle_ws_stream(websocket: WebSocket):
    connected = await ws_manager.connect(websocket)
    if not connected:
        return

    try:
        while True:
            text_data = await websocket.receive_text()
            await ws_manager.handle_incoming_message(websocket, text_data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket client loop exception: {e}")
        ws_manager.disconnect(websocket)

@app.websocket("/api/v1/events/ws")
async def websocket_v1_events(websocket: WebSocket):
    """Authoritative Milestone 5 Real-time Event Streaming Endpoint"""
    await _handle_ws_stream(websocket)

@app.websocket("/ws")
async def websocket_legacy_endpoint(websocket: WebSocket):
    """Backward-compatible endpoint for existing UI clients"""
    await _handle_ws_stream(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)

# --- AUTO-MOUNTED PROVIPAGENT AUTONOMOUS COMPANY (MODULES 1-7) ---
try:
    from app.autonomous_company.router import router as autonomous_company_router
    app.include_router(autonomous_company_router)
except Exception as _e:
    try:
        from backend.app.autonomous_company.router import router as autonomous_company_router
        app.include_router(autonomous_company_router)
    except Exception:
        pass
