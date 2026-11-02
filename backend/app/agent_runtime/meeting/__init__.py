"""
PROVIPAGENT Multi-Agent Meeting Subsystem
Orchestrates structured, multi-agent discussions, turn coordination, consensus voting,
and action item task generation.
"""

from backend.app.agent_runtime.meeting.orchestrator import (
    MeetingOrchestrator,
    meeting_orchestrator,
)

__all__ = ["MeetingOrchestrator", "meeting_orchestrator"]
