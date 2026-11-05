from fastapi import APIRouter
from backend.app.api.v1.endpoints import (
    health,
    agents,
    tasks,
    events,
    approvals,
    artifacts,
    workflows,
    memories,
    tools,
    skills,
    specialists,
    recruitment,
    auth,
    workstations,
    world,
    meetings,
    executions,
    conversations,
)

api_v1_router = APIRouter(prefix="/api/v1")

# Mount sub-routers
api_v1_router.include_router(health.router)
api_v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_v1_router.include_router(agents.router)
api_v1_router.include_router(tasks.router)
api_v1_router.include_router(workflows.router)
api_v1_router.include_router(memories.router, prefix="/memories", tags=["memories"])
api_v1_router.include_router(tools.router)
api_v1_router.include_router(skills.router)
api_v1_router.include_router(events.router)
api_v1_router.include_router(approvals.router)
api_v1_router.include_router(artifacts.router)
api_v1_router.include_router(specialists.router, prefix="/specialists", tags=["specialists"])
api_v1_router.include_router(recruitment.router, prefix="/recruitment", tags=["recruitment"])
api_v1_router.include_router(workstations.router)
api_v1_router.include_router(executions.router)
api_v1_router.include_router(conversations.router)
api_v1_router.include_router(world.router)
api_v1_router.include_router(meetings.router)


