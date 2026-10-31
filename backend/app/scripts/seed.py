import sys
from datetime import datetime
from backend.app.core.database import SessionLocal, engine, Base
from backend.app.models.agent import AgentModel
from backend.app.models import TaskModel, TaskStepModel, AgentEventModel, ApprovalModel, ArtifactModel
from backend.app.models.memory import MemoryModel

CORPORATE_AGENTS = [
    {
        "id": "agent-exec-ceo",
        "name": "Victoria Vance",
        "role": "Chief Executive Officer & Autonomous Strategy Lead",
        "station": "executive_suite",
        "status": "idle",
        "color": "#3b82f6",
        "avatar": "executive-ceo",
        "pos_x": 0.0,
        "pos_y": 0.0,
        "pos_z": 0.0,
        "description": "Chief Executive Officer directing corporate strategy, task decomposition across departments, board governance, and high-risk operational authorizations."
    },
    {
        "id": "agent-eng-lead",
        "name": "David Chen",
        "role": "Principal Systems Architect & Engineering Lead",
        "station": "engineering_bay",
        "status": "idle",
        "color": "#0ea5e9",
        "avatar": "engineer-lead",
        "pos_x": -12.0,
        "pos_y": 0.0,
        "pos_z": -8.0,
        "description": "Lead Software Architect overseeing technical implementation, sandbox subprocess execution, microservices design, and automated testing."
    },
    {
        "id": "agent-research-ai",
        "name": "Dr. Elena Rostova",
        "role": "Chief AI Scientist & Intelligence Director",
        "station": "research_lab",
        "status": "idle",
        "color": "#8b5cf6",
        "avatar": "researcher-lead",
        "pos_x": -12.0,
        "pos_y": 0.0,
        "pos_z": 8.0,
        "description": "Chief AI Scientist conducting deep market intelligence, algorithmic research, semantic memory extraction, and predictive modeling."
    },
    {
        "id": "agent-mkt-growth",
        "name": "Sophia Martinez",
        "role": "VP of Brand Strategy & Growth Marketing",
        "station": "marketing_studio",
        "status": "idle",
        "color": "#f43f5e",
        "avatar": "marketing-lead",
        "pos_x": 12.0,
        "pos_y": 0.0,
        "pos_z": -8.0,
        "description": "VP of Marketing directing global campaign positioning, competitive intelligence, audience analytics, and multi-channel brand deliverables."
    },
    {
        "id": "agent-sales-director",
        "name": "Marcus Reynolds",
        "role": "Director of Enterprise Solutions & Sales",
        "station": "sales_wing",
        "status": "idle",
        "color": "#10b981",
        "avatar": "sales-lead",
        "pos_x": 12.0,
        "pos_y": 0.0,
        "pos_z": 8.0,
        "description": "Director of Enterprise Sales managing high-value client acquisitions, qualification pipelines, proposal generation, and enterprise contracts."
    },
    {
        "id": "agent-fin-controller",
        "name": "Julian Thorne",
        "role": "Chief Financial Officer & Treasury Controller",
        "station": "finance_office",
        "status": "idle",
        "color": "#eab308",
        "avatar": "finance-lead",
        "pos_x": 6.0,
        "pos_y": 0.0,
        "pos_z": 0.0,
        "description": "Chief Financial Officer managing departmental budgets, P&L reporting, unit economics, treasury reserves, and financial compliance auditing."
    },
    {
        "id": "agent-ops-recruiter",
        "name": "Amara Okafor",
        "role": "Head of Operations & AI Agent Recruitment",
        "station": "operations_hub",
        "status": "idle",
        "color": "#06b6d4",
        "avatar": "operations-lead",
        "pos_x": -6.0,
        "pos_y": 0.0,
        "pos_z": 0.0,
        "description": "Head of People and Autonomous Operations managing agent onboarding, role recruitment, load balancing, and cross-department resource allocation."
    },
    {
        "id": "agent-support-lead",
        "name": "Liam O'Connor",
        "role": "Head of Customer Success & Support Operations",
        "station": "support_lounge",
        "status": "idle",
        "color": "#14b8a6",
        "avatar": "support-lead",
        "pos_x": 0.0,
        "pos_y": 0.0,
        "pos_z": 10.0,
        "description": "Head of Client Success managing enterprise SLAs, automated ticket triage, client health scores, and customer retention workflows."
    }
]

INITIAL_AGENTS = CORPORATE_AGENTS

CORPORATE_MEMORIES = [
    {
        "id": "mem-seed-corp-gov-001",
        "title": "Corporate Governance & Executive Sign-off Protocols",
        "content": "All high-risk autonomous operations, including production file writes, shell execution, and financial disbursements over $10,000, require explicit executive authorization from Victoria Vance (CEO) or board delegate. Safe read-only telemetry and data lookups execute automatically.",
        "summary": "Mandatory executive sign-off for high-risk actions and financial workflows.",
        "memory_type": "shared",
        "scope_type": "shared",
        "owner_agent_id": "agent-exec-ceo",
        "confidence": 1.0,
        "verification_status": "verified",
        "status": "active",
    },
    {
        "id": "mem-seed-eng-sandbox-002",
        "title": "Engineering Standards & Subprocess Sandbox Confinement",
        "content": "Engineering tasks must execute strictly inside the isolated workspace_sandbox directory. Subprocesses are constrained with memory and timeout limits. Code deliverables must include automated verification tests before handoff to deployment.",
        "summary": "Engineering subprocess sandbox isolation and automated testing requirements.",
        "memory_type": "shared",
        "scope_type": "shared",
        "owner_agent_id": "agent-eng-lead",
        "confidence": 1.0,
        "verification_status": "verified",
        "status": "active",
    },
    {
        "id": "mem-seed-finance-003",
        "title": "Financial Ledger Auditing & Budget Tracking Standards",
        "content": "Departmental operational budgets are reconciled daily. Burn rate telemetry and invoice generations are archived in the financial ledger. Any budget variance above 5% automatically triggers an alert to Julian Thorne (CFO).",
        "summary": "Daily financial ledger reconciliation and variance alerting protocols.",
        "memory_type": "shared",
        "scope_type": "shared",
        "owner_agent_id": "agent-fin-controller",
        "confidence": 1.0,
        "verification_status": "verified",
        "status": "active",
    },
    {
        "id": "mem-seed-recruitment-004",
        "title": "Autonomous Agent Recruitment & Capability Matrix",
        "content": "When workload metrics exceed 85% capacity in any department, Amara Okafor (Head of Operations) evaluates candidate agent profiles, verifies runtime skill bindings, and initiates agent onboarding into the active headquarters hierarchy.",
        "summary": "Automated agent recruitment pipeline based on departmental workload telemetry.",
        "memory_type": "shared",
        "scope_type": "shared",
        "owner_agent_id": "agent-ops-recruiter",
        "confidence": 1.0,
        "verification_status": "verified",
        "status": "active",
    },
    {
        "id": "mem-seed-support-sla-005",
        "title": "Customer Success SLA & Incident Escalation Policy",
        "content": "Tier-1 client inquiries must receive first-response within 5 minutes. Severity-1 technical incidents are automatically escalated to David Chen (Engineering) with parallel notification to Liam O'Connor (Support).",
        "summary": "Tier-1 response SLA and cross-departmental incident escalation protocol.",
        "memory_type": "shared",
        "scope_type": "shared",
        "owner_agent_id": "agent-support-lead",
        "confidence": 1.0,
        "verification_status": "verified",
        "status": "active",
    }
]

def seed_database():
    print("Connecting to database and verifying schema...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        created_count = 0
        updated_count = 0

        # 1. Seed Default Organization and Users
        from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
        from backend.app.core.auth import hash_password, ROLE_PLATFORM_SUPERADMIN, ROLE_ORGANIZATION_OWNER

        default_org = db.query(OrganizationModel).filter(OrganizationModel.id == "org_default_company").first()
        if not default_org:
            default_org = OrganizationModel(
                id="org_default_company",
                name="Default Corporate Headquarters",
                slug="default-corp",
                tier="ENTERPRISE",
            )
            db.add(default_org)

        superadmin = db.query(UserModel).filter(UserModel.email == "admin@agency.ai").first()
        if not superadmin:
            superadmin = UserModel(
                id="usr-platform-superadmin",
                email="admin@agency.ai",
                hashed_password=hash_password("SuperAdminSecurePassword2026!"),
                full_name="Platform Superadmin",
                is_active=True,
                is_superadmin=True,
            )
            db.add(superadmin)

        owner_user = db.query(UserModel).filter(UserModel.email == "owner@default.corp").first()
        if not owner_user:
            owner_user = UserModel(
                id="usr-org-owner-victoria",
                email="owner@default.corp",
                hashed_password=hash_password("OwnerSecurePassword2026!"),
                full_name="Victoria Vance",
                is_active=True,
                is_superadmin=False,
            )
            db.add(owner_user)

        db.flush()

        if not db.query(OrganizationMemberModel).filter_by(organization_id="org_default_company", user_id=superadmin.id).first():
            db.add(OrganizationMemberModel(
                organization_id="org_default_company",
                user_id=superadmin.id,
                role=ROLE_PLATFORM_SUPERADMIN,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            ))

        if not db.query(OrganizationMemberModel).filter_by(organization_id="org_default_company", user_id=owner_user.id).first():
            db.add(OrganizationMemberModel(
                organization_id="org_default_company",
                user_id=owner_user.id,
                role=ROLE_ORGANIZATION_OWNER,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            ))

        # Preserve recruited specialists: only delete orphan non-corporate, non-recruited agents
        from backend.app.models.recruitment import RecruitmentRecordModel
        valid_ids = [a["id"] for a in CORPORATE_AGENTS]
        recruited_agent_ids = [r[0] for r in db.query(RecruitmentRecordModel.agent_id).all()]
        protected_ids = set(valid_ids) | set(recruited_agent_ids)
        db.query(AgentModel).filter(~AgentModel.id.in_(protected_ids)).delete(synchronize_session=False)

        for agent_data in CORPORATE_AGENTS:
            agent = db.query(AgentModel).filter(AgentModel.id == agent_data["id"]).first()
            if not agent:
                new_agent = AgentModel(
                    id=agent_data["id"],
                    name=agent_data["name"],
                    role=agent_data["role"],
                    station=agent_data["station"],
                    status=agent_data["status"],
                    color=agent_data["color"],
                    avatar=agent_data["avatar"],
                    pos_x=agent_data["pos_x"],
                    pos_y=agent_data["pos_y"],
                    pos_z=agent_data["pos_z"],
                    description=agent_data["description"],
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(new_agent)
                created_count += 1
            else:
                agent.name = agent_data["name"]
                agent.role = agent_data["role"]
                agent.station = agent_data["station"]
                agent.color = agent_data["color"]
                agent.avatar = agent_data["avatar"]
                agent.pos_x = agent_data["pos_x"]
                agent.pos_y = agent_data["pos_y"]
                agent.pos_z = agent_data["pos_z"]
                agent.description = agent_data["description"]
                agent.updated_at = datetime.utcnow()
                updated_count += 1

        db.commit()
        print(f"Seed completed: {created_count} corporate agents created, {updated_count} updated.")

        # Seed initial corporate memories
        mem_created = 0
        valid_mem_ids = [m["id"] for m in CORPORATE_MEMORIES]
        db.query(MemoryModel).filter(~MemoryModel.id.in_(valid_mem_ids)).delete(synchronize_session=False)

        for mem_data in CORPORATE_MEMORIES:
            existing_mem = db.query(MemoryModel).filter(MemoryModel.id == mem_data["id"]).first()
            if not existing_mem:
                new_mem = MemoryModel(
                    id=mem_data["id"],
                    title=mem_data["title"],
                    content=mem_data["content"],
                    summary=mem_data["summary"],
                    memory_type=mem_data["memory_type"],
                    scope_type=mem_data["scope_type"],
                    owner_agent_id=mem_data["owner_agent_id"],
                    confidence=mem_data["confidence"],
                    verification_status=mem_data["verification_status"],
                    status=mem_data["status"],
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(new_mem)
                mem_created += 1
            else:
                existing_mem.title = mem_data["title"]
                existing_mem.content = mem_data["content"]
                existing_mem.summary = mem_data["summary"]
                existing_mem.owner_agent_id = mem_data["owner_agent_id"]
                existing_mem.updated_at = datetime.utcnow()

        db.commit()
        print(f"Corporate memory seed verified: {mem_created} memories added.")

    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
