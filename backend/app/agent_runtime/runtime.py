import logging
from sqlalchemy.orm import Session
from backend.app.agent_runtime.dispatcher.dispatcher import task_dispatcher
from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_tasks
from backend.app.agent_runtime.heartbeat.ceo_heartbeat import ceo_heartbeat
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.policies.engine import policy_engine
from backend.app.agent_runtime.general_agent import GENERAL_AGENT

logger = logging.getLogger("grandline.runtime")

class AgentRuntime:
    """
    Unified entry point for AI Agent City Runtime.
    Coordinates dispatcher worker, crash recovery, tool registry, and security policies.
    """
    def __init__(self):
        self.dispatcher = task_dispatcher
        self.ceo_heartbeat = ceo_heartbeat
        self.tool_registry = default_tool_registry
        self.policy_engine = policy_engine
        self.general_agent = GENERAL_AGENT

    def on_startup(self, db: Session) -> None:
        logger.info("Initializing Agent Runtime lifecycle...")
        # 1. Run crash recovery for orphaned tasks
        recovered = recover_abandoned_tasks(db)
        if recovered > 0:
            logger.info(f"Agent Runtime startup: safely resolved {recovered} abandoned tasks.")

        # 2. Restore active recruited specialist workforce with pinned versions
        try:
            from backend.app.services.recruitment_service import recruitment_service
            recruitment_service.restore_active_workforce(db)
        except Exception as e:
            logger.warning(f"Could not restore active workforce on startup: {e}")

        # 3. Start background task dispatcher
        self.dispatcher.start()

        # 4. Start CEO Supervisory Heartbeat (only runs if CEO_HEARTBEAT_ENABLED=True)
        self.ceo_heartbeat.start()
        logger.info("Agent Runtime initialized and ready for execution.")

    async def on_shutdown(self) -> None:
        logger.info("Shutting down Agent Runtime...")
        await self.ceo_heartbeat.stop()
        await self.dispatcher.stop()
        logger.info("Agent Runtime shutdown complete.")

    def cancel_task(self, task_id: str, reason: str = "User requested cancellation") -> bool:
        return self.dispatcher.request_cancellation(task_id, reason)

agent_runtime = AgentRuntime()
