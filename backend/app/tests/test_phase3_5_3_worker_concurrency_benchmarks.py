import asyncio
import os
import time
import uuid
import pytest
import psutil
from datetime import datetime, timezone
from typing import Dict, Any, List

from backend.app.core.config import settings
from backend.app.core.database import SessionLocal, commit_with_retry
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import MultiAgentOrchestrator
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.llm.base import LLMResponse, ToolCallRequest, LLMUsage, LLMHealthCheckResult


class DeterministicBenchmarkProvider:
    """Zero-cost, ultra-fast deterministic LLM provider for empirical concurrency benchmarks."""
    provider_name = "deterministic-bench"
    model = "mock-bench-1"
    is_live_provider = False

    async def generate(self, messages: list = None, tools: list = None, **kwargs) -> LLMResponse:
        await asyncio.sleep(0.001)  # Simulated 1ms execution slice
        has_tool_result = any(
            (m.get("role") == "tool" or "tool_call_id" in m)
            for m in (messages or [])
            if isinstance(m, dict)
        )
        if has_tool_result:
            return LLMResponse(
                content="Calculation complete. The result has been verified successfully.",
                tool_calls=[],
                usage=LLMUsage(prompt_tokens=15, completion_tokens=15, total_tokens=30, is_free_model=True),
                provider="deterministic-bench",
                model="mock-bench-1",
                finish_reason="stop",
            )

        chosen_tool = "calculator"
        if tools:
            for t in tools:
                t_name = getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else str(t))
                if t_name in ("calculator", "workspace.read_file", "workspace.list"):
                    chosen_tool = t_name
                    break
        tool_args = {"expression": "2 + 2"} if chosen_tool == "calculator" else {"filepath": "bench.txt"}
        return LLMResponse(
            content="Invoking calculation tool to verify step.",
            tool_calls=[
                ToolCallRequest(
                    tool_name=chosen_tool,
                    arguments=tool_args,
                    call_id=f"bench_call_{uuid.uuid4().hex[:8]}",
                )
            ],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, is_free_model=True),
            provider="deterministic-bench",
            model="mock-bench-1",
            finish_reason="stop",
        )

    async def check_health(self) -> LLMHealthCheckResult:
        return LLMHealthCheckResult(
            healthy=True,
            provider="deterministic-bench",
            model="mock-bench-1",
            is_live_provider=False,
        )


@pytest.fixture(scope="function")
def bench_env():
    db = SessionLocal()
    org_id = f"org_bench_{uuid.uuid4().hex[:8]}"
    ceo_id = f"ag_ceo_{uuid.uuid4().hex[:8]}"

    org = OrganizationModel(id=org_id, name="Benchmark Org", slug=org_id.lower(), is_active=True)
    db.add(org)

    ceo = AgentModel(id=ceo_id, name="Benchmark CEO", role="general", status="idle", organization_id=org_id)
    db.add(ceo)
    db.commit()

    yield {"org_id": org_id, "ceo_id": ceo_id, "db": db}

    cleanup_db = SessionLocal()
    try:
        cleanup_db.query(TaskModel).filter(TaskModel.organization_id == org_id).delete()
        cleanup_db.query(AgentEventModel).filter(AgentEventModel.organization_id == org_id).delete()
        cleanup_db.query(AgentModel).filter(AgentModel.organization_id == org_id).delete()
        cleanup_db.query(OrganizationModel).filter(OrganizationModel.id == org_id).delete()
        cleanup_db.commit()
    except Exception:
        pass
    finally:
        cleanup_db.close()
    db.close()


async def run_worker_scale_benchmark(
    worker_count: int,
    subtask_count: int,
    bench_env: dict,
    monkeypatch,
) -> Dict[str, Any]:
    """
    Executes a fan-out workflow with `subtask_count` independent tasks
    under bounded `worker_count` concurrency, recording latency distributions.
    """
    db = bench_env["db"]
    org_id = bench_env["org_id"]
    ceo_id = bench_env["ceo_id"]

    # Seed worker agents
    worker_agent_ids = []
    for i in range(min(worker_count, 20)):
        ag_id = f"ag_w_{i}_{uuid.uuid4().hex[:6]}"
        ag = AgentModel(
            id=ag_id,
            name=f"Worker {i}",
            role="general",
            status="idle",
            organization_id=org_id,
        )
        db.add(ag)
        worker_agent_ids.append(ag_id)
    db.commit()

    # Create parent workflow
    wf_id = f"wf-bench-{worker_count}w-{uuid.uuid4().hex[:6]}"
    parent_task = TaskModel(
        id=wf_id,
        title=f"Benchmark Workflow {worker_count} Workers",
        description="Scalability benchmark run",
        status="queued",
        task_type="workflow",
        assigned_agent_id=ceo_id,
        organization_id=org_id,
    )
    db.add(parent_task)

    # Create subtasks
    subtasks = []
    for i in range(subtask_count):
        assigned_ag = worker_agent_ids[i % len(worker_agent_ids)]
        st = TaskModel(
            id=f"st-bench-{worker_count}w-{i}-{uuid.uuid4().hex[:6]}",
            parent_task_id=wf_id,
            title=f"Benchmark Subtask {i}",
            description=f"Independent work item {i}",
            status="pending",
            task_type="subtask",
            assigned_agent_id=assigned_ag,
            organization_id=org_id,
            input_data_json={"subtask_key": f"task_{i}"},
            dependencies_json=[], # fully parallel
        )
        db.add(st)
        subtasks.append(st)
    db.commit()

    provider = DeterministicBenchmarkProvider()
    monkeypatch.setattr(
        "backend.app.agent_runtime.orchestrator.multi_agent_orchestrator.get_llm_provider",
        lambda *args, **kwargs: provider,
    )

    process = psutil.Process(os.getpid())
    mem_before_mb = process.memory_info().rss / (1024 * 1024)

    orchestrator = MultiAgentOrchestrator()
    token = CancellationToken()

    t_start = time.perf_counter()
    await orchestrator.execute_workflow(
        task_id=wf_id,
        token=token,
        db=db,
        max_concurrency=worker_count,
    )
    t_end = time.perf_counter()
    total_duration = t_end - t_start

    mem_after_mb = process.memory_info().rss / (1024 * 1024)

    # Verification and metrics calculation
    verify_db = SessionLocal()
    reloaded_wf = verify_db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    reloaded_subs = verify_db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()

    completed_count = sum(1 for s in reloaded_subs if s.status == "completed")
    failed_count = sum(1 for s in reloaded_subs if s.status == "failed")

    # Measure per-subtask execution latencies
    latencies = []
    for s in reloaded_subs:
        if s.started_at and s.completed_at:
            lat = (s.completed_at - s.started_at).total_seconds()
            latencies.append(lat)
        else:
            latencies.append(total_duration / subtask_count)

    latencies.sort()
    p50 = latencies[int(len(latencies) * 0.50)] if latencies else 0.0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0.0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0.0

    throughput_subtasks = subtask_count / total_duration if total_duration > 0 else 0.0
    throughput_workflows = 1.0 / total_duration if total_duration > 0 else 0.0

    verify_db.close()

    return {
        "worker_count": worker_count,
        "subtask_count": subtask_count,
        "wf_status": reloaded_wf.status,
        "completed_count": completed_count,
        "failed_count": failed_count,
        "total_duration_sec": total_duration,
        "throughput_subtasks_per_sec": throughput_subtasks,
        "throughput_workflows_per_sec": throughput_workflows,
        "p50_sec": p50,
        "p95_sec": p95,
        "p99_sec": p99,
        "mem_delta_mb": max(0.0, mem_after_mb - mem_before_mb),
    }


@pytest.mark.asyncio
async def test_3_5_3_01_worker_scale_1_worker(bench_env, monkeypatch):
    """Benchmark A: 1 worker sequential execution."""
    res = await run_worker_scale_benchmark(worker_count=1, subtask_count=10, bench_env=bench_env, monkeypatch=monkeypatch)
    assert res["wf_status"] == "completed"
    assert res["completed_count"] == 10
    assert res["failed_count"] == 0
    print(f"\n[BENCHMARK A-1]   Total: {res['total_duration_sec']:.2f}s | Throughput: {res['throughput_subtasks_per_sec']:.1f} tasks/s | p50: {res['p50_sec']*1000:.1f}ms | p95: {res['p95_sec']*1000:.1f}ms | Mem: {res['mem_delta_mb']:.1f}MB")


@pytest.mark.asyncio
async def test_3_5_3_02_worker_scale_4_workers(bench_env, monkeypatch):
    """Benchmark B: 4 workers (default production cap)."""
    res = await run_worker_scale_benchmark(worker_count=4, subtask_count=16, bench_env=bench_env, monkeypatch=monkeypatch)
    assert res["wf_status"] == "completed"
    assert res["completed_count"] == 16
    assert res["failed_count"] == 0
    print(f"\n[BENCHMARK B-4]   Total: {res['total_duration_sec']:.2f}s | Throughput: {res['throughput_subtasks_per_sec']:.1f} tasks/s | p50: {res['p50_sec']*1000:.1f}ms | p95: {res['p95_sec']*1000:.1f}ms | Mem: {res['mem_delta_mb']:.1f}MB")


@pytest.mark.asyncio
async def test_3_5_3_03_worker_scale_8_workers(bench_env, monkeypatch):
    """Benchmark C: 8 workers."""
    res = await run_worker_scale_benchmark(worker_count=8, subtask_count=16, bench_env=bench_env, monkeypatch=monkeypatch)
    assert res["wf_status"] == "completed"
    assert res["completed_count"] == 16
    print(f"\n[BENCHMARK C-8]   Total: {res['total_duration_sec']:.2f}s | Throughput: {res['throughput_subtasks_per_sec']:.1f} tasks/s | p50: {res['p50_sec']*1000:.1f}ms | p95: {res['p95_sec']*1000:.1f}ms | Mem: {res['mem_delta_mb']:.1f}MB")


@pytest.mark.asyncio
async def test_3_5_3_04_worker_scale_16_workers(bench_env, monkeypatch):
    """Benchmark D: 16 workers."""
    res = await run_worker_scale_benchmark(worker_count=16, subtask_count=20, bench_env=bench_env, monkeypatch=monkeypatch)
    assert res["wf_status"] == "completed"
    assert res["completed_count"] == 20
    print(f"\n[BENCHMARK D-16]  Total: {res['total_duration_sec']:.2f}s | Throughput: {res['throughput_subtasks_per_sec']:.1f} tasks/s | p50: {res['p50_sec']*1000:.1f}ms | p95: {res['p95_sec']*1000:.1f}ms | Mem: {res['mem_delta_mb']:.1f}MB")


@pytest.mark.asyncio
async def test_3_5_3_05_worker_scale_32_workers(bench_env, monkeypatch):
    """Benchmark E: 32 workers."""
    res = await run_worker_scale_benchmark(worker_count=32, subtask_count=32, bench_env=bench_env, monkeypatch=monkeypatch)
    assert res["wf_status"] == "completed"
    assert res["completed_count"] == 32
    print(f"\n[BENCHMARK E-32]  Total: {res['total_duration_sec']:.2f}s | Throughput: {res['throughput_subtasks_per_sec']:.1f} tasks/s | p50: {res['p50_sec']*1000:.1f}ms | p95: {res['p95_sec']*1000:.1f}ms | Mem: {res['mem_delta_mb']:.1f}MB")


@pytest.mark.asyncio
async def test_3_5_3_06_worker_scale_50_workers(bench_env, monkeypatch):
    """Benchmark F: 50 workers."""
    res = await run_worker_scale_benchmark(worker_count=50, subtask_count=50, bench_env=bench_env, monkeypatch=monkeypatch)
    assert res["wf_status"] == "completed"
    assert res["completed_count"] == 50
    print(f"\n[BENCHMARK F-50]  Total: {res['total_duration_sec']:.2f}s | Throughput: {res['throughput_subtasks_per_sec']:.1f} tasks/s | p50: {res['p50_sec']*1000:.1f}ms | p95: {res['p95_sec']*1000:.1f}ms | Mem: {res['mem_delta_mb']:.1f}MB")


@pytest.mark.asyncio
async def test_3_5_3_07_worker_scale_100_workers(bench_env, monkeypatch):
    """Benchmark G: 100 workers fan-out execution."""
    res = await run_worker_scale_benchmark(worker_count=100, subtask_count=100, bench_env=bench_env, monkeypatch=monkeypatch)
    assert res["wf_status"] == "completed"
    assert res["completed_count"] == 100
    assert res["failed_count"] == 0
    print(f"\n[BENCHMARK G-100] Total: {res['total_duration_sec']:.2f}s | Throughput: {res['throughput_subtasks_per_sec']:.1f} tasks/s | p50: {res['p50_sec']*1000:.1f}ms | p95: {res['p95_sec']*1000:.1f}ms | Mem: {res['mem_delta_mb']:.1f}MB")
