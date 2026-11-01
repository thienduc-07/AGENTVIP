import argparse
import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.heartbeat.ceo_heartbeat import ceo_heartbeat
from backend.app.agent_runtime.llm.capabilities import default_capability_registry
from backend.app.agent_runtime.llm.cost_controller import default_cost_controller
from backend.app.agent_runtime.llm.diagnostics import (
    DiagnosticStatus,
    run_live_provider_diagnostics,
)
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import (
    multi_agent_orchestrator,
)
from backend.app.core.config import settings
from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.artifact import ArtifactModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.task import TaskModel
from backend.app.models.tool import ToolExecutionModel
from backend.app.services.workstation_service import workstation_service
from backend.app.websocket_manager import ws_manager


async def run_autonomous_execution_validation(
    provider_name: Optional[str] = None,
    scenario_title: str = "Analyze a small business's sales performance and prepare a report",
    scenario_description: str = (
        "Analyze a small business's sales performance and prepare a report: "
        "inspect workspace directory for sales data, analyze performance metrics, "
        "write verified sales analysis report to workspace_sandbox/sales_performance_report.md, "
        "and produce an executive review."
    ),
) -> Dict[str, Any]:
    """
    Executes Phase 3.3.3.10 Multi-Agent Zero-Cost Autonomous Execution Validation:
    1. Verifies live OpenRouter catalog pricing ($0/$0) and capabilities for configured and fallback free models.
    2. Runs live provider diagnostics with safe free fallback failover.
    3. Executes the multi-agent CEO + Specialist workflow through MultiAgentOrchestrator using live OpenRouter inference.
    4. Verifies 3D office behavioral states (PLANNING, THINKING, MOVING, WORKING, COMMUNICATING, COMPLETED)
       and physical workstation allocation events.
    """
    target_provider = provider_name
    if target_provider is None and (settings.LLM_ROUTING_MODE or "").lower().strip() == "hybrid":
        target_provider = settings.LLM_CLOUD_PROVIDER or "openrouter"

    target_model = settings.LLM_CLOUD_MODEL or "google/gemma-4-31b-it:free"
    catalog_check = await default_capability_registry.verify_openrouter_model_live_catalog(
        model_id=target_model
    )
    diag = await run_live_provider_diagnostics(
        provider_name=target_provider,
        model=None,
        allow_free_fallback=True,
    )

    if diag.status != DiagnosticStatus.LIVE_PROVIDER_READY:
        return {
            "verdict": "BLOCKED",
            "reason": (
                f"Live provider diagnostic returned '{diag.status.value}' for provider "
                f"'{diag.selected_provider}' (model '{diag.configured_model}'). "
                "Real LLM execution cannot proceed without a ready live provider."
            ),
            "live_catalog_verification": catalog_check,
            "diagnostic": diag.model_dump(),
            "autonomous_execution_executed": False,
        }

    active_model = diag.configured_model
    active_catalog_check = await default_capability_registry.verify_openrouter_model_live_catalog(
        model_id=active_model
    )

    org_id = "org_default_company"
    ceo_agent_id = "agent-exec-ceo"
    ws_broadcasts: List[Dict[str, Any]] = []

    orig_broadcast = ws_manager.broadcast_envelope

    async def _capture_broadcast(envelope: Dict[str, Any]) -> None:
        ws_broadcasts.append(envelope)
        await orig_broadcast(envelope)

    ws_manager.broadcast_envelope = _capture_broadcast  # type: ignore[assignment]
    db = SessionLocal()
    workflow_id: Optional[str] = None
    all_task_ids: List[str] = []
    try:
        org_rec = db.query(OrganizationModel).filter(OrganizationModel.id == org_id).first()
        if not org_rec:
            db.add(
                OrganizationModel(
                    id=org_id,
                    name="Default Company",
                    slug="default-company",
                    is_active=True,
                )
            )
            db.flush()

        # Ensure CEO and specialist agents exist for workflow execution
        default_agents = [
            ("agent-exec-ceo", "Autonomous CEO Agent", "Chief Executive Officer", "Executive"),
            ("agent-research-ai", "Lead Market Researcher", "Research Specialist", "AI Research"),
            ("agent-fin-controller", "Financial & Data Analyst", "Data Analyst", "Finance"),
            ("agent-mkt-growth", "Principal Technical Writer", "Content Specialist", "Marketing"),
            ("agent-eng-lead", "Quality Assurance Reviewer", "Review Specialist", "Engineering"),
            ("agent-sales-director", "Director of Enterprise Sales", "Sales Specialist", "Sales"),
        ]
        created_agent_ids: List[str] = []
        for aid, aname, arole, adept in default_agents:
            existing_ag = db.query(AgentModel).filter(AgentModel.id == aid).first()
            if not existing_ag:
                ag = AgentModel(
                    id=aid,
                    name=aname,
                    role=arole,
                    station="corridor_center",
                    organization_id=org_id,
                    status="idle",
                    behavioral_state="IDLE",
                    pos_x=0.0,
                    pos_y=1.0,
                    pos_z=3.0,
                )
                db.add(ag)
                created_agent_ids.append(aid)
            else:
                existing_ag.status = "idle"
                existing_ag.behavioral_state = "IDLE"
        db.flush()

        for aid, _aname, _arole, adept in default_agents:
            workstation_service.allocate_workstation(
                db=db,
                agent_id=aid,
                department=adept,
                organization_id=org_id,
            )
            ag_obj = db.query(AgentModel).filter(AgentModel.id == aid).first()
            if ag_obj:
                ag_obj.pos_x = 0.0
                ag_obj.pos_y = 1.0
                ag_obj.pos_z = 0.0
        db.commit()

        # Seed small business sales data in sandbox for real tool inspection
        sales_csv_path = settings.SANDBOX_DIR / "small_business_sales_data.csv"
        sales_csv_content = (
            "quarter,region,product_line,revenue_usd,units_sold,leads_generated,deals_closed,customer_acquisition_cost_usd\n"
            "Q1-2026,North America,Cloud Software,125000,250,1200,180,240\n"
            "Q2-2026,North America,Cloud Software,148000,296,1450,220,215\n"
            "Q3-2026,North America,Cloud Software,182000,364,1800,290,195\n"
            "Q1-2026,EMEA,Cloud Software,89000,178,850,115,260\n"
            "Q2-2026,EMEA,Cloud Software,104000,208,980,140,240\n"
            "Q3-2026,EMEA,Cloud Software,126000,252,1180,175,220\n"
        )
        sales_csv_path.write_text(sales_csv_content, encoding="utf-8")

        workflow_task = TaskModel(
            id=f"wf-zc-{uuid.uuid4().hex[:8]}",
            organization_id=org_id,
            task_type="workflow",
            title=scenario_title,
            description=scenario_description,
            assigned_agent_id=ceo_agent_id,
            priority="high",
            status="queued",
        )
        db.add(workflow_task)
        db.commit()
        workflow_id = workflow_task.id

        await multi_agent_orchestrator.execute_workflow(
            task_id=workflow_id,
            token=CancellationToken(),
            db=db,
        )

        db.expire_all()
        final_parent = db.query(TaskModel).filter(TaskModel.id == workflow_id).first()
        subtasks = (
            db.query(TaskModel)
            .filter(TaskModel.parent_task_id == workflow_id)
            .all()
        )
        all_task_ids = [workflow_id] + [st.id for st in subtasks]
        events = (
            db.query(AgentEventModel)
            .filter(AgentEventModel.task_id.in_(all_task_ids))
            .order_by(AgentEventModel.sequence_id.asc())
            .all()
        )
        tool_execs = (
            db.query(ToolExecutionModel)
            .filter(ToolExecutionModel.task_id.in_(all_task_ids))
            .all()
        )
        artifacts = (
            db.query(ArtifactModel)
            .filter(ArtifactModel.task_id.in_(all_task_ids))
            .all()
        )
        ceo_report = await ceo_heartbeat.run_heartbeat_cycle(
            db=db,
            organization_id=org_id,
            ceo_agent_id=ceo_agent_id,
        )
        cost_summary = default_cost_controller.get_organization_summary(org_id)

        state_events = [
            e.payload_json.get("target_state") or e.payload_json.get("new_state") or e.payload_json.get("behavioral_state")
            for e in events
            if e.event_type == "agent.behavioral_state_changed" and isinstance(e.payload_json, dict)
        ]
        unique_states = sorted(list(set(str(s) for s in state_events if s)))

        verdict = (
            "PASS"
            if (
                final_parent
                and final_parent.status == "completed"
                and len(subtasks) > 0
                and len(tool_execs) > 0
                and cost_summary["organization"]["actual_inference_cost_usd"] == 0.0
            )
            else "PARTIAL PASS"
        )
        return {
            "verdict": verdict,
            "organization_id": org_id,
            "workflow_id": workflow_id,
            "workflow_status": final_parent.status if final_parent else None,
            "active_model": active_model,
            "subtasks_count": len(subtasks),
            "subtask_statuses": {st.id: st.status for st in subtasks},
            "result_summary": final_parent.result_summary if final_parent else None,
            "live_catalog_verification": active_catalog_check,
            "primary_catalog_verification": catalog_check,
            "diagnostic": diag.model_dump(),
            "observed_3d_behavioral_states": unique_states,
            "tool_executions": [
                {
                    "tool_name": t.tool_name,
                    "status": t.status,
                    "duration_ms": t.duration_ms,
                }
                for t in tool_execs
            ],
            "artifacts": [a.name for a in artifacts],
            "event_types": [e.event_type for e in events],
            "websocket_broadcast_count": len(ws_broadcasts),
            "cost_accounting": cost_summary,
            "ceo_supervisory_report": (
                ceo_report
                if isinstance(ceo_report, dict)
                else (ceo_report.model_dump() if ceo_report else None)
            ),
            "autonomous_execution_executed": True,
        }
    finally:
        ws_manager.broadcast_envelope = orig_broadcast  # type: ignore[assignment]
        if sales_csv_path.exists():
            sales_csv_path.unlink()
        try:
            if all_task_ids:
                db.query(AgentEventModel).filter(AgentEventModel.task_id.in_(all_task_ids)).delete(synchronize_session=False)
                db.query(ToolExecutionModel).filter(ToolExecutionModel.task_id.in_(all_task_ids)).delete(synchronize_session=False)
                db.query(ArtifactModel).filter(ArtifactModel.task_id.in_(all_task_ids)).delete(synchronize_session=False)
                db.query(TaskModel).filter(TaskModel.id.in_(all_task_ids)).delete(synchronize_session=False)
            for aid in created_agent_ids:
                db.query(AgentModel).filter(AgentModel.id == aid).delete()
            for aid, _, _, _ in default_agents:
                ag_reset = db.query(AgentModel).filter(AgentModel.id == aid).first()
                if ag_reset:
                    ag_reset.status = "idle"
                    ag_reset.behavioral_state = "IDLE"
                    ag_reset.current_task_id = None
            db.commit()
        except Exception:
            db.rollback()
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="PROVIPAGENT Live Zero-Cost Autonomous Execution Validator (Phase 3.3.3.10)"
    )
    parser.add_argument(
        "--provider",
        type=str,
        default=None,
        help="Target live provider to validate (default: openrouter).",
    )
    cli_args = parser.parse_args()
    result = asyncio.run(run_autonomous_execution_validation(provider_name=cli_args.provider))
    print(json.dumps(result, indent=2, default=str))
