import re
import json
import asyncio
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import desc

from backend.app.core.database import commit_with_retry
from backend.app.core.errors import (
    NotFoundError,
    ValidationError,
    ConflictError,
)
from backend.app.models.meeting import (
    MeetingModel,
    MeetingParticipantModel,
    MeetingMessageModel,
    MeetingDecisionModel,
    MeetingVoteModel,
    MeetingActionItemModel,
)
from backend.app.models.agent import AgentModel
from backend.app.services.meeting_service import meeting_service
from backend.app.services.event_service import (
    event_service,
    MEETING_TURN_STARTED,
    MEETING_TURN_COMPLETED,
)
from backend.app.agent_runtime.llm.factory import get_llm_provider
from backend.app.agent_runtime.llm.base import LLMProvider
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("agency.meeting.orchestrator")


class MeetingOrchestrator:
    def __init__(self, provider: Optional[LLMProvider] = None):
        self._provider = provider

    def get_provider(self, organization_id: str = "default-org") -> LLMProvider:
        if self._provider:
            return self._provider
        try:
            return get_llm_provider(organization_id=organization_id)
        except Exception as e:
            logger.warning(f"Could not load primary LLM provider, falling back to deterministic: {e}")
            from backend.app.agent_runtime.llm.deterministic_provider import DeterministicProvider
            return DeterministicProvider()

    # -------------------------------------------------------------------------
    # Speaker Selection & Coordination
    # -------------------------------------------------------------------------

    def determine_next_speaker(
        self,
        meeting: MeetingModel,
    ) -> Optional[MeetingParticipantModel]:
        """
        Determines the next participant eligible to speak based on:
        - Meeting type & format (MODERATOR_FIRST, ROUND_ROBIN, STRUCTURED_DEBATE)
        - Speaking order and previous contribution counts
        - Disagreement or active decision context
        """
        active_participants = [
            p for p in meeting.participants
            if p.participation_status not in ("REMOVED", "FAILED", "FINISHED")
        ]
        if not active_participants:
            return None

        # Sort active participants by speaking order
        active_participants.sort(key=lambda p: p.speaking_order)

        messages = meeting.messages
        # Turn 0: If no messages have been spoken yet, moderator speaks first if present
        if not messages:
            moderator = next((p for p in active_participants if p.role == "MODERATOR"), None)
            return moderator or active_participants[0]

        last_message = messages[-1]
        last_speaker_agent_id = last_message.agent_id

        # Format 1: STRUCTURED_DEBATE
        if meeting.meeting_type == "STRUCTURED_DEBATE":
            msg_count = len(messages)
            # Stage 1 (msg 0): Moderator Opening
            # Stage 2 (msg 1): Presenter / Affirmative Specialist proposal
            # Stage 3 (msg 2): Critic / Analyst challenge
            # Stage 4 (msg 3): Rebuttal by Presenter
            # Stage 5 (msg 4): Concluding synthesis by Moderator
            if msg_count == 1:
                presenter = next(
                    (p for p in active_participants if p.role in ("PRESENTER", "SPECIALIST") and p.agent_id != last_speaker_agent_id),
                    None
                )
                if presenter:
                    return presenter
            elif msg_count == 2:
                critic = next(
                    (p for p in active_participants if p.role in ("CRITIC", "ANALYST") and p.agent_id != last_speaker_agent_id),
                    None
                )
                if critic:
                    return critic
            elif msg_count == 3:
                # Rebuttal by initial presenter
                first_speaker_id = messages[1].agent_id if len(messages) > 1 else None
                first_speaker = next((p for p in active_participants if p.agent_id == first_speaker_id), None)
                if first_speaker:
                    return first_speaker
            elif msg_count >= 4:
                # Moderator closes
                moderator = next((p for p in active_participants if p.role == "MODERATOR"), None)
                if moderator and last_speaker_agent_id != moderator.agent_id:
                    return moderator
                return None

        # Format 2: ROUND_ROBIN & MODERATOR_FIRST
        # Find current speaker index in active list
        last_idx = -1
        for idx, p in enumerate(active_participants):
            if p.agent_id == last_speaker_agent_id:
                last_idx = idx
                break

        next_idx = (last_idx + 1) % len(active_participants)
        candidate = active_participants[next_idx]

        # In MODERATOR_FIRST, if we have looped through all participants once,
        # moderator speaks again to synthesize decisions
        min_contributions = min(p.contribution_count for p in active_participants)
        max_contributions = max(p.contribution_count for p in active_participants)

        # Allow up to 2 rounds of discussion per meeting before concluding
        if min_contributions >= 2:
            # Let moderator speak final synthesis if not last speaker
            moderator = next((p for p in active_participants if p.role == "MODERATOR"), None)
            if moderator and last_speaker_agent_id != moderator.agent_id and moderator.contribution_count <= min_contributions:
                return moderator
            return None

        return candidate

    # -------------------------------------------------------------------------
    # Discussion Protocol & Structured Parsing
    # -------------------------------------------------------------------------

    def parse_agent_discourse(self, raw_text: str) -> Dict[str, Any]:
        """
        Parses structured sections from agent response:
        - position: Core position or stance
        - reasoning: Step-by-step logic
        - evidence: Facts or benchmark citations
        - risks: Identified failure modes
        - recommendations: Concrete proposals
        - confidence: Float 0.0 - 1.0
        - proposed_actions: List of action strings
        - proposed_decision: Optional decision proposal dict
        """
        result: Dict[str, Any] = {
            "position": None,
            "reasoning": None,
            "evidence": None,
            "risks": None,
            "recommendations": None,
            "confidence": 0.85,
            "proposed_actions": [],
            "proposed_decision": None,
        }

        # Regex patterns for markdown or labeled fields
        patterns = {
            "position": r"(?:Position|Stance):\s*([^\n]+(?:\n(?!\s*(?:Reasoning|Evidence|Risks|Recommendations|Confidence|Proposed Actions|PROPOSE DECISION):)[^\n]+)*)",
            "reasoning": r"Reasoning:\s*([^\n]+(?:\n(?!\s*(?:Position|Evidence|Risks|Recommendations|Confidence|Proposed Actions|PROPOSE DECISION):)[^\n]+)*)",
            "evidence": r"Evidence:\s*([^\n]+(?:\n(?!\s*(?:Position|Reasoning|Risks|Recommendations|Confidence|Proposed Actions|PROPOSE DECISION):)[^\n]+)*)",
            "risks": r"(?:Risks|Trade-offs):\s*([^\n]+(?:\n(?!\s*(?:Position|Reasoning|Evidence|Recommendations|Confidence|Proposed Actions|PROPOSE DECISION):)[^\n]+)*)",
            "recommendations": r"Recommendations:\s*([^\n]+(?:\n(?!\s*(?:Position|Reasoning|Evidence|Risks|Confidence|Proposed Actions|PROPOSE DECISION):)[^\n]+)*)",
            "confidence": r"Confidence:\s*([0-1](?:\.\d+)?)",
            "proposed_actions": r"Proposed Actions:\s*([^\n]+(?:\n(?!\s*(?:Position|Reasoning|Evidence|Risks|Recommendations|Confidence|PROPOSE DECISION):)[^\n]+)*)",
        }

        for key, pat in patterns.items():
            match = re.search(pat, raw_text, re.IGNORECASE)
            if match:
                val = match.group(1).strip()
                if key == "confidence":
                    try:
                        result[key] = float(val)
                    except ValueError:
                        result[key] = 0.85
                elif key == "proposed_actions":
                    # Split lines or semicolons
                    items = [
                        re.sub(r"^[-*•\d.]+\s*", "", item).strip()
                        for item in re.split(r"[;\n]", val)
                        if item.strip()
                    ]
                    result[key] = items
                else:
                    result[key] = val

        # Fallback parsing if sections were omitted
        if not result["position"]:
            first_sentence = raw_text.split(".")[0].strip()
            result["position"] = first_sentence if first_sentence else raw_text[:120]

        if not result["reasoning"] and len(raw_text) > 100:
            result["reasoning"] = raw_text

        # Detect decision proposal inside discourse
        dec_match = re.search(r"PROPOSE DECISION:\s*([^\n]+)\s*-\s*([^\n]+)", raw_text, re.IGNORECASE)
        if dec_match:
            result["proposed_decision"] = {
                "title": dec_match.group(1).strip(),
                "description": dec_match.group(2).strip(),
                "voting_policy": "SIMPLE_MAJORITY",
            }

        return result

    def generate_deterministic_turn(
        self,
        meeting: MeetingModel,
        participant: MeetingParticipantModel,
        messages: List[MeetingMessageModel],
    ) -> Tuple[str, str, Dict[str, Any]]:
        """
        Generates realistic, deterministic structured discourse for an agent
        when running offline, in test environments, or under strict zero-cost budget.
        Returns (content, message_type, metadata_json).
        """
        agent_name = participant.agent.name if participant.agent else "Specialist"
        role = participant.role
        objective = meeting.objective or meeting.title
        msg_count = len(messages)

        if role == "MODERATOR":
            if msg_count == 0:
                message_type = "OPENING"
                content = (
                    f"Welcome everyone to this session regarding: '{meeting.title}'.\n\n"
                    f"**Objective:** {objective}\n\n"
                    f"I open the floor for our team to present their initial assessments, data evidence, and potential risks. "
                    f"Please state your position clearly with supporting rationale."
                )
                structured = {
                    "position": "Open meeting and set objective agenda",
                    "reasoning": f"Alignment required across participants on {objective}",
                    "confidence": 1.0,
                    "proposed_actions": ["Collect participant inputs"],
                }
            else:
                message_type = "SUMMARY"
                content = (
                    f"Thank you all for the substantive discussion. Reviewing our dialogue:\n"
                    f"- We have evaluated key proposals and identified operational risk mitigations.\n"
                    f"- Consensus supports executing the verified solution with automated rollback hooks.\n\n"
                    f"**PROPOSE DECISION:** Adopt Recommended Solution - Authorize implementation with automated safety verification.\n\n"
                    f"I recommend we formalize this direction and assign concrete action items."
                )
                structured = {
                    "position": "Synthesize discussion and call for decision execution",
                    "reasoning": "Clear consensus reached with acceptable risk mitigations",
                    "confidence": 0.95,
                    "proposed_actions": [f"Finalize deliverables for {meeting.title}"],
                    "proposed_decision": {
                        "title": f"Approve implementation for {meeting.title}",
                        "description": f"Authorize execution plan developed during meeting '{meeting.title}'.",
                        "voting_policy": "SIMPLE_MAJORITY",
                    },
                }

        elif role in ("CRITIC", "ANALYST"):
            message_type = "CRITICISM" if msg_count >= 1 else "STATEMENT"
            content = (
                f"**Position:** The proposed direction is viable, but we must mitigate edge-case vulnerabilities.\n"
                f"**Reasoning:** Without comprehensive telemetry and fallback boundaries, unexpected load spikes or data drift could compromise SLA guarantees.\n"
                f"**Evidence:** Performance benchmarks under simulated stress demonstrated elevated tail latencies when concurrency exceeded threshold.\n"
                f"**Risks:** Cascading retry storm if downstream dependencies fail intermittently.\n"
                f"**Recommendations:** Enforce rate-limiting circuit breakers and set conservative timeout thresholds before production rollout.\n"
                f"**Confidence:** 0.92\n"
                f"**Proposed Actions:** Implement circuit breaker configuration; Run load verification suite"
            )
            structured = self.parse_agent_discourse(content)

        elif role in ("PRESENTER", "RESEARCHER"):
            message_type = "PROPOSAL" if msg_count <= 2 else "REBUTTAL"
            content = (
                f"**Position:** Proceed with the phased architecture rollout to achieve our objective.\n"
                f"**Reasoning:** Phased execution allows incremental verification while maintaining complete backward compatibility with existing systems.\n"
                f"**Evidence:** Unit and integration regression suites passed 100% across all target workloads with zero regressions.\n"
                f"**Risks:** Slightly increased deployment duration due to staged canary verification.\n"
                f"**Recommendations:** Begin with low-traffic shard validation, verify health metrics, then scale horizontally.\n"
                f"**Confidence:** 0.94\n"
                f"**Proposed Actions:** Deploy canary release to staging environment"
            )
            structured = self.parse_agent_discourse(content)

        else:  # SPECIALIST / DECISION_MAKER / OBSERVER
            message_type = "STATEMENT"
            content = (
                f"**Position:** Concur with the proposed technical plan and commit operational capacity.\n"
                f"**Reasoning:** The proposed risk mitigations address our core operational concerns without adding excessive architectural overhead.\n"
                f"**Evidence:** All integration contracts conform strictly to system interface specifications.\n"
                f"**Risks:** Resource contention during simultaneous batch processing.\n"
                f"**Recommendations:** Schedule heavy asynchronous batch jobs during off-peak maintenance windows.\n"
                f"**Confidence:** 0.90\n"
                f"**Proposed Actions:** Schedule off-peak batch execution window"
            )
            structured = self.parse_agent_discourse(content)

        return content, message_type, structured

    # -------------------------------------------------------------------------
    # Turn Execution Lifecycle
    # -------------------------------------------------------------------------

    async def execute_turn(
        self,
        meeting_id: str,
        db: Session,
        organization_id: str,
    ) -> Dict[str, Any]:
        """
        Executes an authoritative speaking turn in the meeting:
        1. Selects the next eligible participant
        2. Sets participant status to SPEAKING and emits MEETING_TURN_STARTED
        3. Invokes LLM (or deterministic fallback)
        4. Parses structured discourse
        5. Saves MeetingMessageModel via MeetingService
        6. Creates any proposed decisions or action items
        7. Sets participant status to LISTENING and emits MEETING_TURN_COMPLETED
        8. Returns turn summary
        """
        meeting = meeting_service.get_meeting(db, meeting_id, organization_id=organization_id)

        if meeting.status != "IN_PROGRESS":
            raise ConflictError(
                message=f"Cannot execute turn: meeting '{meeting_id}' has status '{meeting.status}' (must be IN_PROGRESS)",
                code="MEETING_NOT_IN_PROGRESS",
            )

        speaker_part = self.determine_next_speaker(meeting)
        now = datetime.utcnow()

        # If no speaker is eligible, the meeting has concluded all discussion cycles
        if not speaker_part:
            logger.info(f"Meeting '{meeting.id}' completed all scheduled speaking turns. Generating transcript and closing.")
            transcript = meeting_service.generate_transcript(db, meeting.id, organization_id)
            meeting_service.complete_meeting(db, meeting.id, organization_id)
            return {
                "meeting_id": meeting.id,
                "status": "COMPLETED",
                "message": "Meeting successfully concluded all turns",
                "transcript_id": transcript.id,
            }

        # 1. Start Speaking Turn
        speaker_part.participation_status = "SPEAKING"
        db.flush()

        ev_start = event_service.create_event(
            db=db,
            event_type=MEETING_TURN_STARTED,
            agent_id=speaker_part.agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "agent_id": speaker_part.agent_id,
                "role": speaker_part.role,
                "speaking_order": speaker_part.speaking_order,
                "contribution_count": speaker_part.contribution_count,
            },
            commit=False,
        )
        commit_with_retry(db)
        ws_manager.broadcast_sync(ev_start.to_envelope())

        # 2. Generate Discourse Content
        provider = self.get_provider(organization_id=organization_id)
        content: str = ""
        message_type: str = "STATEMENT"
        structured_meta: Dict[str, Any] = {}

        is_deterministic = getattr(provider, "is_live_provider", False) is False

        if is_deterministic:
            content, message_type, structured_meta = self.generate_deterministic_turn(
                meeting=meeting,
                participant=speaker_part,
                messages=meeting.messages,
            )
        else:
            # Live LLM provider execution
            try:
                system_prompt = (
                    f"You are AI Agent '{speaker_part.agent.name}' (Role: {speaker_part.role}) participating in a "
                    f"corporate meeting titled '{meeting.title}'.\n"
                    f"Objective: {meeting.objective or meeting.title}\n"
                    f"Provide your contribution following this structured protocol:\n"
                    f"Position: <your stance>\n"
                    f"Reasoning: <logical justification>\n"
                    f"Evidence: <data/facts/test results>\n"
                    f"Risks: <potential pitfalls>\n"
                    f"Recommendations: <clear proposal>\n"
                    f"Confidence: <0.0 to 1.0>\n"
                    f"Proposed Actions: <action 1; action 2>\n"
                )
                history = [
                    {"role": "user" if m.agent_id != speaker_part.agent_id else "assistant", "content": m.content}
                    for m in meeting.messages[-5:]
                ]
                messages = [{"role": "system", "content": system_prompt}] + history
                llm_resp = await provider.generate(messages=messages, temperature=0.3)
                content = llm_resp.content or ""
                structured_meta = self.parse_agent_discourse(content)
                message_type = "STATEMENT" if speaker_part.role != "MODERATOR" else "SUMMARY"
            except Exception as e:
                logger.warning(f"Live LLM generation failed for turn in meeting '{meeting_id}': {e}. Falling back to deterministic.")
                content, message_type, structured_meta = self.generate_deterministic_turn(
                    meeting=meeting,
                    participant=speaker_part,
                    messages=meeting.messages,
                )

        # 3. Record Message
        msg = meeting_service.create_message(
            db=db,
            meeting_id=meeting.id,
            organization_id=organization_id,
            content=content,
            agent_id=speaker_part.agent_id,
            message_type=message_type,
            metadata_json=structured_meta,
        )

        # 4. Handle Proposed Decisions
        proposed_decision = structured_meta.get("proposed_decision")
        decision_created = None
        if proposed_decision and isinstance(proposed_decision, dict):
            try:
                decision_created = meeting_service.propose_decision(
                    db=db,
                    meeting_id=meeting.id,
                    organization_id=organization_id,
                    title=proposed_decision.get("title", f"Decision from {speaker_part.agent.name}"),
                    description=proposed_decision.get("description", "Proposed during meeting discussion"),
                    proposed_by=speaker_part.agent_id,
                    voting_policy=proposed_decision.get("voting_policy", "SIMPLE_MAJORITY"),
                )
            except Exception as e:
                logger.warning(f"Could not automatically create proposed decision: {e}")

        # 5. Handle Proposed Action Items
        action_items_created = []
        proposed_actions = structured_meta.get("proposed_actions", [])
        if proposed_actions and isinstance(proposed_actions, list):
            for action_text in proposed_actions[:2]:  # Limit to top 2 items per turn
                if action_text and len(action_text.strip()) > 5:
                    try:
                        from backend.app.schemas.meeting import MeetingActionItemCreate
                        action_item = meeting_service.create_action_item(
                            db=db,
                            meeting_id=meeting.id,
                            organization_id=organization_id,
                            item_in=MeetingActionItemCreate(
                                title=action_text.strip()[:180],
                                description=f"Generated from turn by {speaker_part.agent.name} in meeting '{meeting.title}'.",
                                assigned_agent_id=speaker_part.agent_id,
                                decision_id=decision_created.id if decision_created else None,
                                create_linked_task=True,
                            ),
                            assigned_by=speaker_part.agent_id,
                        )
                        action_items_created.append(action_item.id)
                    except Exception as e:
                        logger.warning(f"Could not automatically create action item: {e}")

        # 6. Complete Speaking Turn
        speaker_part.participation_status = "LISTENING"
        ev_complete = event_service.create_event(
            db=db,
            event_type=MEETING_TURN_COMPLETED,
            agent_id=speaker_part.agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "agent_id": speaker_part.agent_id,
                "message_id": msg.id,
                "sequence_number": msg.sequence_number,
                "decisions_created": [decision_created.id] if decision_created else [],
                "action_items_created": action_items_created,
            },
            commit=False,
        )
        commit_with_retry(db)
        ws_manager.broadcast_sync(ev_complete.to_envelope())

        return {
            "meeting_id": meeting.id,
            "status": "IN_PROGRESS",
            "message_id": msg.id,
            "agent_id": speaker_part.agent_id,
            "sequence_number": msg.sequence_number,
            "message_type": message_type,
            "content": content,
            "structured_meta": structured_meta,
            "decision_id": decision_created.id if decision_created else None,
            "action_items_count": len(action_items_created),
        }

    def execute_turn_sync(
        self,
        meeting_id: str,
        db: Session,
        organization_id: str,
    ) -> Dict[str, Any]:
        """Synchronous wrapper for execute_turn."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Run inside existing event loop via concurrent future or nest_asyncio
                import nest_asyncio
                nest_asyncio.apply()
                return loop.run_until_complete(self.execute_turn(meeting_id, db, organization_id))
            else:
                return loop.run_until_complete(self.execute_turn(meeting_id, db, organization_id))
        except RuntimeError:
            return asyncio.run(self.execute_turn(meeting_id, db, organization_id))


meeting_orchestrator = MeetingOrchestrator()
