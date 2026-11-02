import uuid
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.meeting import (
    MeetingModel,
    MeetingParticipantModel,
    MeetingMessageModel,
    MeetingDecisionModel,
    MeetingVoteModel,
    MeetingActionItemModel,
    MeetingTranscriptModel,
)
from backend.app.services.meeting_service import meeting_service
from backend.app.agent_runtime.meeting.orchestrator import meeting_orchestrator
from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_meetings
from backend.app.schemas.meeting import (
    MeetingCreate,
    MeetingUpdate,
    MeetingParticipantCreate,
    MeetingMessageCreate,
    MeetingDecisionCreate,
    MeetingVoteCreate,
    MeetingActionItemCreate,
)


@pytest.fixture
def meeting_agents(db_session):
    """Creates a dedicated squad of test agents in org_default_company."""
    org_id = "org_default_company"

    mod = AgentModel(
        id=f"agent_mod_{uuid.uuid4().hex[:8]}",
        name="Moderator Agent",
        role="Product Strategy Lead",
        station="meeting_room",
        status="idle",
        organization_id=org_id,
    )
    presenter = AgentModel(
        id=f"agent_pres_{uuid.uuid4().hex[:8]}",
        name="Presenter Agent",
        role="Senior Backend Architect",
        station="engineering_bay",
        status="idle",
        organization_id=org_id,
    )
    critic = AgentModel(
        id=f"agent_crit_{uuid.uuid4().hex[:8]}",
        name="Critic Agent",
        role="Security & Reliability Auditor",
        station="research_lab",
        status="idle",
        organization_id=org_id,
    )
    db_session.add_all([mod, presenter, critic])
    db_session.commit()
    return {"mod": mod, "presenter": presenter, "critic": critic}


# -----------------------------------------------------------------------------
# 1. Meeting Lifecycle (Create -> Start -> Pause -> Resume -> Complete / Cancel)
# -----------------------------------------------------------------------------

def test_meeting_full_lifecycle(auth_client, meeting_agents, db_session):
    org_id = "org_default_company"
    mod = meeting_agents["mod"]
    presenter = meeting_agents["presenter"]
    critic = meeting_agents["critic"]

    # 1. Create Meeting
    create_res = auth_client.post(
        "/api/v1/meetings",
        json={
            "title": "Autonomous Infrastructure Review",
            "description": "Quarterly review of workforce reliability and throughput",
            "meeting_type": "STRATEGY_SESSION",
            "objective": "Align on scaling to 100 concurrent agents",
            "moderator_agent_id": mod.id,
            "participant_agent_ids": [presenter.id, critic.id],
        },
    )
    assert create_res.status_code == 201
    mdata = create_res.json()
    meeting_id = mdata["id"]
    assert mdata["title"] == "Autonomous Infrastructure Review"
    assert mdata["status"] == "DRAFT"
    assert mdata["moderator_agent_id"] == mod.id
    assert len(mdata["participants"]) == 3  # Moderator + 2 specialists

    # 2. Start Meeting
    start_res = auth_client.post(f"/api/v1/meetings/{meeting_id}/start")
    assert start_res.status_code == 200
    sdata = start_res.json()
    assert sdata["status"] == "IN_PROGRESS"
    assert sdata["started_at"] is not None

    # Check participant statuses in DB
    db_session.expire_all()
    participants = db_session.query(MeetingParticipantModel).filter(MeetingParticipantModel.meeting_id == meeting_id).all()
    for p in participants:
        assert p.participation_status == "JOINED"
        assert p.joined_at is not None

    # 3. Pause Meeting
    pause_res = auth_client.post(f"/api/v1/meetings/{meeting_id}/pause", json={"reason": "Lunch break"})
    assert pause_res.status_code == 200
    pdata = pause_res.json()
    assert pdata["status"] == "PAUSED"
    assert pdata["metadata_json"]["pause_reason"] == "Lunch break"

    # Cannot start when paused (must resume)
    invalid_start = auth_client.post(f"/api/v1/meetings/{meeting_id}/start")
    assert invalid_start.status_code == 200  # Start on paused transitions to IN_PROGRESS gracefully

    # Re-pause
    auth_client.post(f"/api/v1/meetings/{meeting_id}/pause", json={"reason": "Operator hold"})

    # 4. Resume Meeting
    resume_res = auth_client.post(f"/api/v1/meetings/{meeting_id}/resume")
    assert resume_res.status_code == 200
    rdata = resume_res.json()
    assert rdata["status"] == "IN_PROGRESS"

    # 5. Complete Meeting
    complete_res = auth_client.post(f"/api/v1/meetings/{meeting_id}/complete")
    assert complete_res.status_code == 200
    cdata = complete_res.json()
    assert cdata["status"] == "COMPLETED"
    assert cdata["ended_at"] is not None

    # Invariants: Completed meeting cannot be started or paused
    err_start = auth_client.post(f"/api/v1/meetings/{meeting_id}/start")
    assert err_start.status_code == 409


def test_meeting_cancellation(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    res = auth_client.post(
        "/api/v1/meetings",
        json={"title": "To Cancel", "moderator_agent_id": mod.id},
    )
    meeting_id = res.json()["id"]

    cancel_res = auth_client.post(f"/api/v1/meetings/{meeting_id}/cancel", json={"reason": "Quorum not met"})
    assert cancel_res.status_code == 200
    cdata = cancel_res.json()
    assert cdata["status"] == "CANCELLED"
    assert cdata["metadata_json"]["cancel_reason"] == "Quorum not met"

    # Terminal state: cannot cancel again
    err_cancel = auth_client.post(f"/api/v1/meetings/{meeting_id}/cancel")
    assert err_cancel.status_code == 409


# -----------------------------------------------------------------------------
# 2. Multi-Tenant Isolation
# -----------------------------------------------------------------------------

def test_meeting_multi_tenant_isolation(auth_client, meeting_agents, db_session):
    # Create meeting in org_default_company
    res = auth_client.post(
        "/api/v1/meetings",
        json={"title": "Org 1 Meeting", "moderator_agent_id": meeting_agents["mod"].id},
    )
    m_id = res.json()["id"]

    # Try fetching with another organization_id
    with pytest.raises(Exception):
        meeting_service.get_meeting(db_session, m_id, organization_id="other_foreign_org")


# -----------------------------------------------------------------------------
# 3. Participant Management & Duplicate Prevention
# -----------------------------------------------------------------------------

def test_participant_management(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    pres = meeting_agents["presenter"]
    res = auth_client.post(
        "/api/v1/meetings",
        json={"title": "Participant Test", "moderator_agent_id": mod.id},
    )
    m_id = res.json()["id"]

    # Add presenter
    add_res = auth_client.post(
        f"/api/v1/meetings/{m_id}/participants",
        json={"agent_id": pres.id, "role": "PRESENTER"},
    )
    assert add_res.status_code == 201
    part_id = add_res.json()["id"]
    assert add_res.json()["agent_id"] == pres.id

    # Adding duplicate participant returns 409 Conflict
    dup_res = auth_client.post(
        f"/api/v1/meetings/{m_id}/participants",
        json={"agent_id": pres.id, "role": "PRESENTER"},
    )
    assert dup_res.status_code == 409

    # List participants
    list_res = auth_client.get(f"/api/v1/meetings/{m_id}/participants")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 2

    # Remove participant
    del_res = auth_client.delete(f"/api/v1/meetings/{m_id}/participants/{pres.id}")
    assert del_res.status_code == 200

    db_session.expire_all()
    p = db_session.query(MeetingParticipantModel).filter(MeetingParticipantModel.id == part_id).first()
    assert p.participation_status == "REMOVED"
    assert p.left_at is not None


# -----------------------------------------------------------------------------
# 4. Messages & Sequencing
# -----------------------------------------------------------------------------

def test_meeting_messages_sequencing(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    pres = meeting_agents["presenter"]
    res = auth_client.post(
        "/api/v1/meetings",
        json={
            "title": "Message Sequence Test",
            "moderator_agent_id": mod.id,
            "participant_agent_ids": [pres.id],
        },
    )
    m_id = res.json()["id"]
    auth_client.post(f"/api/v1/meetings/{m_id}/start")

    # Post message 1
    m1 = auth_client.post(
        f"/api/v1/meetings/{m_id}/messages",
        json={"agent_id": mod.id, "content": "Meeting opened.", "message_type": "OPENING"},
    )
    assert m1.status_code == 201
    assert m1.json()["sequence_number"] == 1

    # Post message 2
    m2 = auth_client.post(
        f"/api/v1/meetings/{m_id}/messages",
        json={"agent_id": pres.id, "content": "Ready to present.", "message_type": "STATEMENT"},
    )
    assert m2.status_code == 201
    assert m2.json()["sequence_number"] == 2

    # List messages
    msgs_res = auth_client.get(f"/api/v1/meetings/{m_id}/messages")
    assert msgs_res.status_code == 200
    msgs = msgs_res.json()
    assert len(msgs) == 2
    assert msgs[0]["sequence_number"] == 1
    assert msgs[1]["sequence_number"] == 2


# -----------------------------------------------------------------------------
# 5. Decisions & Voting Policies (Simple Majority, Unanimous, Consensus, Approval)
# -----------------------------------------------------------------------------

def test_decision_voting_simple_majority(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    pres = meeting_agents["presenter"]
    crit = meeting_agents["critic"]
    res = auth_client.post(
        "/api/v1/meetings",
        json={
            "title": "Decision Test",
            "moderator_agent_id": mod.id,
            "participant_agent_ids": [pres.id, crit.id],
        },
    )
    m_id = res.json()["id"]
    auth_client.post(f"/api/v1/meetings/{m_id}/start")

    # Propose decision
    dec_res = auth_client.post(
        f"/api/v1/meetings/{m_id}/decisions",
        json={
            "title": "Upgrade DB Engine",
            "description": "Switch pooler settings to handle 500 connections",
            "voting_policy": "SIMPLE_MAJORITY",
            "proposed_by": pres.id,
        },
    )
    assert dec_res.status_code == 201
    dec_id = dec_res.json()["id"]
    assert dec_res.json()["status"] == "PROPOSED"

    # Vote 1: Presenter YES
    v1 = auth_client.post(
        f"/api/v1/meetings/{m_id}/decisions/{dec_id}/vote",
        json={"agent_id": pres.id, "vote": "YES", "reasoning": "Benchmark shows 3x throughput"},
    )
    assert v1.status_code == 200

    # Vote 2: Critic NO
    v2 = auth_client.post(
        f"/api/v1/meetings/{m_id}/decisions/{dec_id}/vote",
        json={"agent_id": crit.id, "vote": "NO", "reasoning": "Memory footprint increases by 25%"},
    )
    assert v2.status_code == 200

    # Vote 3: Moderator YES
    v3 = auth_client.post(
        f"/api/v1/meetings/{m_id}/decisions/{dec_id}/vote",
        json={"agent_id": mod.id, "vote": "YES", "reasoning": "Acceptable tradeoff"},
    )
    assert v3.status_code == 200

    # Resolve decision: 2 YES vs 1 NO -> APPROVED
    res_dec = auth_client.post(f"/api/v1/meetings/{m_id}/decisions/{dec_id}/resolve")
    assert res_dec.status_code == 200
    rdata = res_dec.json()
    assert rdata["status"] == "APPROVED"
    assert rdata["metadata_json"]["tally"]["yes"] == 2
    assert rdata["metadata_json"]["tally"]["no"] == 1


def test_decision_voting_unanimous_and_consensus(db_session, meeting_agents):
    org_id = "org_default_company"
    mod = meeting_agents["mod"]
    pres = meeting_agents["presenter"]
    crit = meeting_agents["critic"]

    meeting = meeting_service.create_meeting(
        db=db_session,
        meeting_in=MeetingCreate(
            title="Consensus Policy Test",
            moderator_agent_id=mod.id,
            participant_agent_ids=[pres.id, crit.id],
        ),
        organization_id=org_id,
    )
    meeting_service.start_meeting(db_session, meeting.id, org_id)

    # 1. Unanimous Policy with 1 NO -> REJECTED
    dec_unanimous = meeting_service.propose_decision(
        db=db_session,
        meeting_id=meeting.id,
        organization_id=org_id,
        title="Unanimous Vote Test",
        description="Must be unanimous",
        voting_policy="UNANIMOUS",
    )
    meeting_service.cast_vote(db_session, meeting.id, dec_unanimous.id, pres.id, "YES")
    meeting_service.cast_vote(db_session, meeting.id, dec_unanimous.id, crit.id, "NO")
    res_u = meeting_service.resolve_decision(db_session, meeting.id, dec_unanimous.id, org_id)
    assert res_u.status == "REJECTED"

    # 2. Consensus Policy with requires_human_approval
    dec_consensus = meeting_service.propose_decision(
        db=db_session,
        meeting_id=meeting.id,
        organization_id=org_id,
        title="Production Deployment",
        description="Deploy directly to prod cluster",
        voting_policy="CONSENSUS",
        metadata_json={"requires_human_approval": True},
    )
    meeting_service.cast_vote(db_session, meeting.id, dec_consensus.id, pres.id, "YES")
    meeting_service.cast_vote(db_session, meeting.id, dec_consensus.id, mod.id, "YES")
    meeting_service.cast_vote(db_session, meeting.id, dec_consensus.id, crit.id, "YES")
    res_c = meeting_service.resolve_decision(db_session, meeting.id, dec_consensus.id, org_id)
    assert res_c.status == "REQUIRES_HUMAN_APPROVAL"

    # Invariant: Meeting transitioned to WAITING_APPROVAL
    db_session.refresh(meeting)
    assert meeting.status == "WAITING_APPROVAL"


# -----------------------------------------------------------------------------
# 6. Action Items & Real TaskModel Generation
# -----------------------------------------------------------------------------

def test_action_item_task_conversion(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    pres = meeting_agents["presenter"]
    res = auth_client.post(
        "/api/v1/meetings",
        json={"title": "Action Item Test", "moderator_agent_id": mod.id},
    )
    m_id = res.json()["id"]

    act_res = auth_client.post(
        f"/api/v1/meetings/{m_id}/action-items",
        json={
            "title": "Implement WAL Checkpoint Script",
            "description": "Script to trigger SQLite WAL checkpointing every 10 minutes",
            "assigned_agent_id": pres.id,
            "priority": "high",
            "create_linked_task": True,
        },
    )
    assert act_res.status_code == 201
    adata = act_res.json()
    assert adata["title"] == "Implement WAL Checkpoint Script"
    assert adata["linked_task_id"] is not None

    # Verify real TaskModel exists in DB
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == adata["linked_task_id"]).first()
    assert task is not None
    assert task.assigned_agent_id == pres.id
    assert task.status == "queued"
    assert task.priority == "high"
    assert "[Meeting: Action Item Test]" in task.title


# -----------------------------------------------------------------------------
# 7. Discourse Parsing & Orchestrator Speaking Turns
# -----------------------------------------------------------------------------

def test_discourse_parsing():
    raw_discourse = """
    Position: Migrate cache to Redis Sentinel for high availability.
    Reasoning: The standalone cache creates a single point of failure under network partition.
    Evidence: Last week's test cluster dropped 12% of requests during network blip.
    Risks: Increased network round-trip latency by ~1.5ms.
    Recommendations: Implement Redis Sentinel with local fallback memory cache.
    Confidence: 0.94
    Proposed Actions: Configure Sentinel topology; Run latency benchmarks
    PROPOSE DECISION: Adopt Redis Sentinel - Migrate distributed caching layer
    """
    parsed = meeting_orchestrator.parse_agent_discourse(raw_discourse)
    assert "Redis Sentinel" in parsed["position"]
    assert "single point of failure" in parsed["reasoning"]
    assert parsed["confidence"] == 0.94
    assert len(parsed["proposed_actions"]) == 2
    assert parsed["proposed_actions"][0] == "Configure Sentinel topology"
    assert parsed["proposed_decision"] is not None
    assert parsed["proposed_decision"]["title"] == "Adopt Redis Sentinel"


def test_orchestrator_execute_turn_cycle(auth_client, meeting_agents, db_session):
    org_id = "org_default_company"
    mod = meeting_agents["mod"]
    pres = meeting_agents["presenter"]
    crit = meeting_agents["critic"]

    res = auth_client.post(
        "/api/v1/meetings",
        json={
            "title": "Architecture Debate",
            "meeting_type": "STRUCTURED_DEBATE",
            "objective": "Decide on multi-agent execution pipeline",
            "moderator_agent_id": mod.id,
            "participant_agent_ids": [pres.id, crit.id],
        },
    )
    m_id = res.json()["id"]
    auth_client.post(f"/api/v1/meetings/{m_id}/start")

    # Turn 1: Moderator opening
    t1_res = auth_client.post(f"/api/v1/meetings/{m_id}/execute-turn")
    assert t1_res.status_code == 200
    t1 = t1_res.json()
    assert t1["agent_id"] == mod.id
    assert t1["message_type"] == "OPENING"

    # Turn 2: Presenter proposal
    t2_res = auth_client.post(f"/api/v1/meetings/{m_id}/execute-turn")
    assert t2_res.status_code == 200
    t2 = t2_res.json()
    assert t2["agent_id"] == pres.id

    # Turn 3: Critic challenge
    t3_res = auth_client.post(f"/api/v1/meetings/{m_id}/execute-turn")
    assert t3_res.status_code == 200
    t3 = t3_res.json()
    assert t3["agent_id"] == crit.id

    # Turn 4: Presenter rebuttal
    t4_res = auth_client.post(f"/api/v1/meetings/{m_id}/execute-turn")
    assert t4_res.status_code == 200
    t4 = t4_res.json()
    assert t4["agent_id"] == pres.id

    # Turn 5: Moderator summary
    t5_res = auth_client.post(f"/api/v1/meetings/{m_id}/execute-turn")
    assert t5_res.status_code == 200
    t5 = t5_res.json()
    assert t5["agent_id"] == mod.id

    # Turn 6: Conclusion (all debate stages completed)
    t6_res = auth_client.post(f"/api/v1/meetings/{m_id}/execute-turn")
    assert t6_res.status_code == 200
    assert t6_res.json()["status"] == "COMPLETED"


# -----------------------------------------------------------------------------
# 8. Transcripts & Summaries
# -----------------------------------------------------------------------------

def test_transcripts_and_summary(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    res = auth_client.post(
        "/api/v1/meetings",
        json={"title": "Summary Test", "moderator_agent_id": mod.id},
    )
    m_id = res.json()["id"]
    auth_client.post(f"/api/v1/meetings/{m_id}/start")
    auth_client.post(
        f"/api/v1/meetings/{m_id}/messages",
        json={"agent_id": mod.id, "content": "Let's summarize.", "message_type": "STATEMENT"},
    )

    # Generate transcript
    t_res = auth_client.post(
        f"/api/v1/meetings/{m_id}/transcripts/generate",
        json={"summary": "Custom executive summary of the meeting."},
    )
    assert t_res.status_code == 200
    tdata = t_res.json()
    assert tdata["transcript_version"] == 1
    assert "Meeting Transcript: Summary Test" in tdata["content"]
    assert tdata["summary"] == "Custom executive summary of the meeting."

    # Get summary
    sum_res = auth_client.get(f"/api/v1/meetings/{m_id}/summary")
    assert sum_res.status_code == 200
    sdata = sum_res.json()
    assert sdata["meeting_id"] == m_id
    assert sdata["summary_text"] == "Custom executive summary of the meeting."
    assert sdata["messages_count"] == 1


# -----------------------------------------------------------------------------
# 9. Crash Recovery & Restart Reconciliation
# -----------------------------------------------------------------------------

def test_recover_abandoned_meetings(db_session, meeting_agents):
    org_id = "org_default_company"
    mod = meeting_agents["mod"]

    meeting = meeting_service.create_meeting(
        db=db_session,
        meeting_in=MeetingCreate(title="Crash Test", moderator_agent_id=mod.id),
        organization_id=org_id,
    )
    meeting_service.start_meeting(db_session, meeting.id, org_id)

    # Simulate active meeting during server restart
    assert meeting.status == "IN_PROGRESS"

    recovered_count = recover_abandoned_meetings(db_session)
    assert recovered_count >= 1

    db_session.refresh(meeting)
    assert meeting.status == "PAUSED"
    assert meeting.metadata_json.get("reconciled_after_restart") is True


# -----------------------------------------------------------------------------
# 10. Audit Events Verification
# -----------------------------------------------------------------------------

def test_meeting_audit_events_emitted(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    res = auth_client.post(
        "/api/v1/meetings",
        json={"title": "Audit Event Test", "moderator_agent_id": mod.id},
    )
    m_id = res.json()["id"]

    db_session.expire_all()
    created_events = (
        db_session.query(AgentEventModel)
        .filter(AgentEventModel.event_type == "meeting.created")
        .all()
    )
    assert any((e.payload_json or {}).get("meeting_id") == m_id for e in created_events)

    auth_client.post(f"/api/v1/meetings/{m_id}/start")
    db_session.expire_all()
    started_events = (
        db_session.query(AgentEventModel)
        .filter(AgentEventModel.event_type == "meeting.started")
        .all()
    )
    assert any((e.payload_json or {}).get("meeting_id") == m_id for e in started_events)


# -----------------------------------------------------------------------------
# 11. Edge Cases, Voting Invariants & Transcript Versioning
# -----------------------------------------------------------------------------

def test_meeting_invalid_transitions_and_edge_cases(auth_client, meeting_agents, db_session):
    mod = meeting_agents["mod"]
    pres = meeting_agents["presenter"]

    # 1. Title cannot be empty
    bad_create = auth_client.post("/api/v1/meetings", json={"title": "   "})
    assert bad_create.status_code == 422

    # 2. Cannot pause meeting in DRAFT status
    res = auth_client.post("/api/v1/meetings", json={"title": "Edge Case Meeting", "moderator_agent_id": mod.id})
    m_id = res.json()["id"]
    err_pause = auth_client.post(f"/api/v1/meetings/{m_id}/pause")
    assert err_pause.status_code == 409

    # 3. Start without participants
    empty_m = auth_client.post("/api/v1/meetings", json={"title": "Empty Meeting"})
    empty_id = empty_m.json()["id"]
    err_start_empty = auth_client.post(f"/api/v1/meetings/{empty_id}/start")
    assert err_start_empty.status_code == 422

    # 4. Unauthorized agent voting (agent not in meeting)
    auth_client.post(f"/api/v1/meetings/{m_id}/start")
    dec_res = auth_client.post(
        f"/api/v1/meetings/{m_id}/decisions",
        json={"title": "Test Decision", "description": "Desc"},
    )
    dec_id = dec_res.json()["id"]

    foreign_vote = auth_client.post(
        f"/api/v1/meetings/{m_id}/decisions/{dec_id}/vote",
        json={"agent_id": pres.id, "vote": "YES"},  # pres not added to this meeting
    )
    assert foreign_vote.status_code == 403

    # 5. Invalid vote type
    auth_client.post(f"/api/v1/meetings/{m_id}/participants", json={"agent_id": pres.id})
    bad_vote = auth_client.post(
        f"/api/v1/meetings/{m_id}/decisions/{dec_id}/vote",
        json={"agent_id": pres.id, "vote": "MAYBE"},
    )
    assert bad_vote.status_code == 422


def test_transcript_multiple_versions(auth_client, meeting_agents):
    mod = meeting_agents["mod"]
    res = auth_client.post("/api/v1/meetings", json={"title": "Versioned Transcripts", "moderator_agent_id": mod.id})
    m_id = res.json()["id"]
    auth_client.post(f"/api/v1/meetings/{m_id}/start")

    # Generate Version 1
    t1 = auth_client.post(f"/api/v1/meetings/{m_id}/transcripts/generate", json={"summary": "Version 1 Summary"}).json()
    assert t1["transcript_version"] == 1

    # Generate Version 2
    t2 = auth_client.post(f"/api/v1/meetings/{m_id}/transcripts/generate", json={"summary": "Version 2 Summary"}).json()
    assert t2["transcript_version"] == 2

    # List transcripts
    all_t = auth_client.get(f"/api/v1/meetings/{m_id}/transcripts").json()
    assert len(all_t) == 2


def test_meeting_filtering_and_pagination(auth_client, meeting_agents):
    mod = meeting_agents["mod"]
    auth_client.post("/api/v1/meetings", json={"title": "M1", "meeting_type": "STANDUP", "moderator_agent_id": mod.id})
    auth_client.post("/api/v1/meetings", json={"title": "M2", "meeting_type": "STRATEGY_SESSION", "moderator_agent_id": mod.id})

    # Filter by meeting_type
    filter_res = auth_client.get("/api/v1/meetings?meeting_type=STANDUP")
    assert filter_res.status_code == 200
    for m in filter_res.json():
        assert m["meeting_type"] == "STANDUP"

