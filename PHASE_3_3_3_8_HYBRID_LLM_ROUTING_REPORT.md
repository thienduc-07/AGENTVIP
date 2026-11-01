# PHASE 3.3.3.8 — HYBRID LLM INTELLIGENCE & DYNAMIC PROVIDER ROUTING REPORT

**Date:** 2026-11-02  
**Project:** PROVIPAGENT — Autonomous AI Company OS  
**Phase:** 3.3.3.8 — Hybrid LLM Intelligence & Dynamic Provider Routing  

---

## 0. Pre-Implementation Architecture Assessment

1. **Provider Lifecycle & Dependency Injection**:
   * `TaskDispatcher._process_single_task` (`backend/app/agent_runtime/dispatcher/dispatcher.py`) and `MultiAgentOrchestrator.execute_workflow` (`backend/app/agent_runtime/orchestrator/multi_agent_orchestrator.py`) obtain an `LLMProvider` from `get_llm_provider(...)` (`backend/app/agent_runtime/llm/factory.py`) and inject it into `Planner`, `MultiAgentPlanner`, and `ExecutionLoop.run(...)`.
   * Extending `get_llm_provider(...)` to return `HybridLLMRouter` (which implements the `LLMProvider` protocol) when `LLM_ROUTING_MODE=hybrid` ensures **zero agents can bypass routing, capability checks, or cloud budget policies** while preserving 100% backward compatibility with existing single-provider and offline tests.
2. **Token & Cost Recording**:
   * Previously, `TaskContext` (`backend/app/agent_runtime/context.py`) only tracked per-task token and estimated cost totals in memory during `ExecutionLoop.run()`. There was no tenant-isolated organization daily/monthly cloud budget ledger, per-task cloud request counter (`MAX_TASK_CLOUD_REQUESTS`), per-agent ledger, or distinction between provider-reported actual cost (`usage.cost`) and estimated cost.
3. **Task Complexity & Model Capabilities**:
   * Previously, tasks were dispatched directly to a single static provider without evaluating task complexity (`LOW`, `MEDIUM`, `HIGH`), model capability requirements (`tool_calling`, `structured_output`, `json_mode`, `max_context_tokens`), or cached provider health states.

---

## 1. Architecture Changes

Implemented five cohesive modules inside `backend/app/agent_runtime/llm/` and integrated them into `factory.py`, `executor.py`, `dispatcher.py`, `multi_agent_orchestrator.py`, and `/api/v1/health/llm-routing`:

```
Agent Runtime (TaskDispatcher / MultiAgentOrchestrator / ExecutionLoop)
        |
        v
HybridLLMRouter (backend/app/agent_runtime/llm/router.py)
  |
  +---> TaskComplexityAnalyzer (backend/app/agent_runtime/llm/complexity.py)
  |       Deterministic 0..100 multi-factor scoring -> LOW | MEDIUM | HIGH
  |
  +---> ModelCapabilityRegistry (backend/app/agent_runtime/llm/capabilities.py)
  |       Verifies text_generation, tool_calling, structured_output, json_mode, context window
  |
  +---> CloudCostController (backend/app/agent_runtime/llm/cost_controller.py)
  |       Enforces tenant-isolated Org daily/monthly & Task cloud USD/request caps
  |
  +---> ProviderHealthMonitor (backend/app/agent_runtime/llm/health_monitor.py)
  |       TTL-cached health states: HEALTHY | DEGRADED | UNAVAILABLE | AUTHENTICATION_ERROR | MODEL_UNAVAILABLE | UNKNOWN
  |
  +---> Local Tier: OllamaProvider  <---(Controlled Single-Hop Failover)---> Cloud Tier: OpenRouter (OpenAIProvider)
```

---

## 2. Intelligent Task Routing Logic (`complexity.py` & `router.py`)

### 2.1 Deterministic Multi-Factor Complexity Scoring (`TaskComplexityAnalyzer`)
Without making any extra LLM calls or relying on arbitrary single-keyword matching, `TaskComplexityAnalyzer.analyze()` computes an explainable `0..100` score and `CapabilityRequirement` from four factors:
1. **Context & Token Volume Factor**: Estimates token count across `messages` and serialized `tools` (`< 450` tokens `+4`, `450..2500` tokens `+12`, `2500..8000` tokens `+25`, `> 8000` tokens `+35` and `require_long_context=True`).
2. **Tool Schema & Multi-Turn Execution Factor**: Number of bound tools (`1` tool `+10`, `2..4` tools `+15`, `>= 5` tools `+22`) and prior `role: "tool"` turns in conversation history (`+10` to `+18`).
3. **Structural & Reasoning Depth Factor**: Evaluates multi-step plan density (`plan_steps_count`), JSON schema requirements (`require_json_mode`), and domain synthesis indicators (`LOW` routine `-10`, `MEDIUM` analysis/report `+16..28`, `HIGH` multi-agent DAG / architecture / security audit `+28..45`).
4. **Task & Agent Metadata Factor**: Incorporates `task_priority` (`low`, `medium`, `high`, `critical`) and executive/orchestrator agent scope.

### 2.2 Tier Routing Policy
* **`LOW` (`score < 30`)**: Routes to **Ollama** (local). Falls back to **OpenRouter** (cloud) only if local is unavailable/incapable AND `LLM_ALLOW_CLOUD_FALLBACK=true` AND within cloud budget.
* **`MEDIUM` (`30 <= score < 65`)**: Routes to **Ollama** if the configured local model satisfies `CapabilityRequirement` (including `tool_calling` when tools are present) and `ProviderHealthMonitor` reports `HEALTHY`/`DEGRADED`; otherwise routes to **OpenRouter** if cloud fallback is permitted and within budget.
* **`HIGH` (`score >= 65`)**: Routes directly to **OpenRouter** after verifying cloud capability compatibility, health, and organization/task cloud budgets.

---

## 3. Model Capability Registry (`capabilities.py`)

`ModelCapabilityRegistry` maintains explicit capability declarations per `(provider, model_id)`:
* `text_generation`, `tool_calling`, `structured_output`, `json_mode`, `long_context`, `max_context_tokens`, `vision`, `streaming`, `recommended_min_ram_gb`, `estimated_disk_gb`.
* Pre-registered local Ollama models include `qwen2.5:3b`, `qwen2.5:1.5b`, `llama3.2:3b`, `llama3.2:1b`, `llama3.1`, `llama3.1:8b`, `llama3`, `qwen2.5:7b` (`tool_calling=True`), as well as text-only models like `tinyllama` and `phi3:mini` (`tool_calling=False`).
* Pre-registered cloud models include `openai/gpt-4o-mini`, `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`, `google/gemini-2.0-flash-001`, `meta-llama/llama-3.3-70b-instruct`, `gpt-4o-mini`, `gpt-4o`, `llama-3.3-70b-versatile`, and `gemini-2.0-flash`.
* Unregistered models default conservatively to `tool_calling=False` so the router never assumes an arbitrary model supports tool calling.

---

## 4. Cloud Cost Governance (`cost_controller.py`)

`CloudCostController` enforces strict, tenant-isolated spending limits:
* **Per-Task Cloud Cost Limit**: `MAX_TASK_CLOUD_COST_USD = 0.10`
* **Organization Daily Cloud Cost Limit**: `MAX_ORGANIZATION_DAILY_CLOUD_COST_USD = 1.00`
* **Organization Monthly Cloud Cost Limit**: `MAX_ORGANIZATION_MONTHLY_CLOUD_COST_USD = 20.00`
* **Per-Task Cloud Request Limit**: `MAX_TASK_CLOUD_REQUESTS = 10`
* **Per-Request Token Limit**: `MAX_TOKENS_PER_REQUEST = 4096`
* **Actual vs. Estimated Cost Tracking**:
  * Local `Ollama` requests record `$0.00` (`is_estimated_cost=False`).
  * Cloud requests inspect `usage.cost` / `usage.total_cost` from OpenRouter/OpenAI responses: when reported by the provider, `actual_cost_usd` is recorded with `is_estimated_cost=False`; when not reported by the provider, cost is computed from `MODEL_PRICING_PER_1M_TOKENS` and explicitly flagged with `is_estimated_cost=True`.

---

## 5. Failover Behavior & Provider Health Monitor (`health_monitor.py` & `router.py`)

* **Provider Health States**: `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `AUTHENTICATION_ERROR`, `MODEL_UNAVAILABLE`, `UNKNOWN`.
* **TTL Caching**: Health checks are cached for `LLM_HEALTH_CHECK_INTERVAL_SECONDS = 30.0` seconds and use lightweight metadata endpoints (`/api/tags`, `/models`) so health monitoring **never** generates paid chat completion calls.
* **Controlled Single-Hop Failover**:
  * `Ollama unavailable -> Check LLM_ALLOW_CLOUD_FALLBACK -> Check ModelCapabilityRegistry -> Check Org & Task Cloud Budgets -> Check OpenRouter Health -> Execute Cloud Inference`.
  * Each tier (`local`, `cloud`) is attempted at most once per `generate()` call — preventing infinite fallback loops, repeated provider switching, or duplicate tool executions.

---

## 6. Security & Observability Assessment

* **Explainable Routing Telemetry (`RoutingDecisionRecord`)**: Every routing decision records `decision_id`, `organization_id`, `task_id`, `agent_id`, `selected_provider`, `selected_model`, `task_complexity`, `complexity_score`, `routing_reason`, `fallback_triggered`, `fallback_reason`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd`, `is_estimated_cost`, `execution_duration_ms`, `provider_status`, and `success`.
* **Administrative Diagnostics Endpoint (`GET /api/v1/health/llm-routing`)**: Requires authentication and filters routing decisions and cost ledgers strictly by the caller's `tenant_org`.
* **Secret Redaction**: All error strings, health snapshots, and fallback reasons pass through `redact_secrets()`. Raw prompts and API keys are never exposed.

---

## 7. Machine Hardware Inspection Results (Task 10)

Inspected the actual host machine via `uname -m`, `sysctl`, `df -h .`, and `which ollama`:

| Resource / Component | Inspected Value | Impact on Local LLM Selection |
| :--- | :--- | :--- |
| **CPU Architecture** | `arm64` | Native Apple Silicon Metal acceleration supported |
| **Processor** | **Apple M3** (8 cores) | Fast unified memory bandwidth for 1B–3B quantized models |
| **System RAM** | **8 GB Unified Memory** (`8,589,934,592` bytes) | Shared between macOS, Next.js/Three.js, FastAPI, and Ollama; 30B/70B or even 8B models will cause memory pressure/swap |
| **Available Disk Space** | **3.9 GiB free** (`186 GiB / 228 GiB` used, `98%` capacity) | **Critical constraint**: A 4.7 GB 7B/8B model (`llama3.1:8b`) cannot fit in the 3.9 GiB available disk space |
| **Ollama Binary** | **Not installed** (`ollama not found`) | Must be installed before local inference can run |
| **Ollama Server** | **Not running** (`localhost:11434` unreachable) | Must be started via `ollama serve` |

---

## 8. Recommended Local Ollama Model

Based on the actual **Apple M3 + 8 GB Unified RAM + 3.9 GiB free disk space**:
1. **Primary Recommended Model**: **`qwen2.5:3b`** (~1.9 GB disk download, ~2.5 GB unified RAM footprint)
   * Fits comfortably within the 3.9 GiB available disk space and 8 GB unified memory alongside the 3D frontend and backend.
   * Supports native tool calling (`tool_calling=True`), structured JSON output, and 32K context.
2. **Alternative Recommended Model**: **`llama3.2:3b`** (~2.0 GB disk download, ~2.6 GB unified RAM footprint)
   * Also supports native tool calling and fits within current disk/RAM limits.
3. **Ultra-Compact Fallback (if free disk drops below 2.0 GB)**: **`qwen2.5:1.5b`** (~0.98 GB disk download, ~1.5 GB RAM).
4. **Do NOT pull 8B, 30B, or 70B models** on this machine unless disk space is freed (at least 10+ GB free) and heavy background apps are closed.

---

## 9. Backend and Frontend Test Results (Task 11)

| Test / Verification Suite | Command | Result |
| :--- | :--- | :--- |
| **Phase 3.3.3.8 Hybrid Routing Suite (17 tests)** | `./venv/bin/pytest backend/app/tests/test_phase3_3_3_8_hybrid_llm_routing.py -v` | **PASS** (`17 passed` in 0.09s) |
| **Full Backend Regression Suite** | `./venv/bin/pytest -q` | **PASS** (`296 passed` in 10.02s) |
| **Full Frontend Test Suite** | `cd frontend && npm test` | **PASS** (`7 passed` test files, `63 passed` tests) |
| **TypeScript Typecheck** | `cd frontend && npx tsc --noEmit` | **PASS** (`0 errors`) |
| **Next.js Production Build** | `cd frontend && npm run build` | **PASS** (Compiled & prerendered cleanly) |
| **Graphify Knowledge Graph Update** | `graphify update .` | **PASS** (`11734+ nodes` updated in `graphify-out/`) |

---

## 10. Remaining Blockers & Exact Setup Instructions

### Remaining Blockers for Live Autonomous Execution
* **Ollama** is not yet installed/running on this host (`localhost:11434` unreachable).
* **OpenRouter API Key** (`OPENROUTER_API_KEY` / `LLM_API_KEY`) is not yet configured in `.env`.

### Exact Setup Instructions
1. **Install & Start Local Ollama (Recommended 1.9 GB Model for Apple M3 8GB)**:
   ```bash
   brew install ollama
   ollama serve &
   ollama pull qwen2.5:3b
   ```
2. **Configure `.env` for Hybrid Routing**:
   Add to `/Users/thienduc/Desktop/Code/provipagent/.env`:
   ```env
   LLM_ROUTING_MODE=hybrid
   LLM_LOCAL_PROVIDER=ollama
   LLM_LOCAL_BASE_URL=http://localhost:11434
   LLM_LOCAL_MODEL=qwen2.5:3b
   LLM_CLOUD_PROVIDER=openrouter
   LLM_CLOUD_MODEL=openai/gpt-4o-mini
   OPENROUTER_API_KEY=<your-openrouter-api-key>
   LLM_ALLOW_CLOUD_FALLBACK=true
   MAX_TASK_CLOUD_COST_USD=0.10
   MAX_ORGANIZATION_DAILY_CLOUD_COST_USD=1.00
   MAX_TASK_CLOUD_REQUESTS=10
   ```
3. **Verify Live Provider Readiness & Run End-to-End Autonomous Validation**:
   ```bash
   ./venv/bin/python -m backend.app.agent_runtime.llm.diagnostics --all
   ./venv/bin/python -m backend.app.agent_runtime.llm.live_e2e_validator
   ```

---

## 11. Final Verdict

* **Hybrid LLM Routing Architecture & Test Verification**: **`PASS`** (`296 passed` backend tests including all 16 required hybrid routing, failover, capability, cost governance, tenant isolation, and secret redaction scenarios; `63 passed` frontend tests; `0` TypeScript errors; production build `PASS`).
* **Live Provider Inference & End-to-End Autonomous Execution**: **`BLOCKED`** (Separate live-execution status remains `BLOCKED` until Ollama is installed/started with `qwen2.5:3b` or `OPENROUTER_API_KEY` is provisioned in `.env`; per directive rules, we do not proceed to Phase 3.3.4 until live execution validation succeeds).

