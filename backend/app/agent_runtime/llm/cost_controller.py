import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from pydantic import BaseModel

from backend.app.core.config import settings
from backend.app.agent_runtime.llm.base import (
    LLMBudgetExceededError,
    LLMUsage,
    estimate_llm_cost_usd,
)

logger = logging.getLogger("grandline.llm.cost_controller")


class TaskCloudLedger(BaseModel):
    task_id: str
    organization_id: str
    cloud_requests: int = 0
    local_requests: int = 0
    free_model_requests: int = 0
    rejected_paid_model_requests: int = 0
    rate_limit_failures: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cloud_cost_usd: float = 0.0
    actual_cloud_cost_usd: float = 0.0
    estimated_cloud_cost_usd: float = 0.0
    actual_inference_cost_usd: float = 0.0
    estimated_inference_cost_usd: float = 0.0


class AgentUsageLedger(BaseModel):
    agent_id: str
    organization_id: str
    cloud_requests: int = 0
    local_requests: int = 0
    free_model_requests: int = 0
    rejected_paid_model_requests: int = 0
    rate_limit_failures: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cloud_cost_usd: float = 0.0
    actual_inference_cost_usd: float = 0.0
    estimated_inference_cost_usd: float = 0.0


class OrganizationCloudLedger(BaseModel):
    organization_id: str
    day_key: str
    month_key: str
    daily_cloud_cost_usd: float = 0.0
    monthly_cloud_cost_usd: float = 0.0
    actual_inference_cost_usd: float = 0.0
    estimated_inference_cost_usd: float = 0.0
    daily_cloud_requests: int = 0
    monthly_cloud_requests: int = 0
    free_model_requests: int = 0
    rejected_paid_model_requests: int = 0
    rate_limit_failures: int = 0
    rate_limit_status: str = "OK"
    nonzero_cost_alert_triggered: bool = False
    nonzero_cost_alert_detail: Optional[str] = None
    total_tokens: int = 0


class CloudCostController:
    """
    Strict tenant-isolated cloud spending, zero-cost policy, and rate-limit controller.
    Enforces:
    - Organization daily cloud USD budget (MAX_ORGANIZATION_DAILY_CLOUD_COST_USD)
    - Organization monthly cloud USD budget (MAX_ORGANIZATION_MONTHLY_CLOUD_COST_USD)
    - Organization daily cloud request quota (MAX_ORGANIZATION_DAILY_CLOUD_REQUESTS)
    - Per-task cloud USD budget (MAX_TASK_CLOUD_COST_USD)
    - Per-task cloud request limit (MAX_TASK_CLOUD_REQUESTS)
    - Maximum tokens per request (MAX_TOKENS_PER_REQUEST)
    - Immediate emergency halt if a verified free model reports nonzero inference cost
    - Per-agent & per-task accounting for actual cost, estimated cost, free requests,
      rejected paid-model requests, and rate-limit failures
    """

    def __init__(self) -> None:
        self._org_ledgers: Dict[str, OrganizationCloudLedger] = {}
        self._task_ledgers: Dict[Tuple[str, str], TaskCloudLedger] = {}
        self._agent_ledgers: Dict[Tuple[str, str], AgentUsageLedger] = {}

    @staticmethod
    def _date_keys() -> Tuple[str, str]:
        now = datetime.now(timezone.utc)
        return (now.strftime("%Y-%m-%d"), now.strftime("%Y-%m"))

    def _get_org_ledger(self, organization_id: str) -> OrganizationCloudLedger:
        org_key = (organization_id or "default-org").strip()
        day_key, month_key = self._date_keys()
        ledger = self._org_ledgers.get(org_key)
        if ledger is None:
            ledger = OrganizationCloudLedger(
                organization_id=org_key,
                day_key=day_key,
                month_key=month_key,
            )
            self._org_ledgers[org_key] = ledger
        else:
            if ledger.day_key != day_key:
                ledger.day_key = day_key
                ledger.daily_cloud_cost_usd = 0.0
                ledger.daily_cloud_requests = 0
                if ledger.rate_limit_status == "DAILY_QUOTA_EXHAUSTED":
                    ledger.rate_limit_status = "OK"
            if ledger.month_key != month_key:
                ledger.month_key = month_key
                ledger.monthly_cloud_cost_usd = 0.0
                ledger.monthly_cloud_requests = 0
        return ledger

    def _get_task_ledger(self, organization_id: str, task_id: str) -> TaskCloudLedger:
        org_key = (organization_id or "default-org").strip()
        t_key = (task_id or "untracked-task").strip()
        key = (org_key, t_key)
        if key not in self._task_ledgers:
            self._task_ledgers[key] = TaskCloudLedger(
                task_id=t_key,
                organization_id=org_key,
            )
        return self._task_ledgers[key]

    def _get_agent_ledger(self, organization_id: str, agent_id: str) -> AgentUsageLedger:
        org_key = (organization_id or "default-org").strip()
        a_key = (agent_id or "untracked-agent").strip()
        key = (org_key, a_key)
        if key not in self._agent_ledgers:
            self._agent_ledgers[key] = AgentUsageLedger(
                agent_id=a_key,
                organization_id=org_key,
            )
        return self._agent_ledgers[key]

    def trigger_nonzero_cost_alert(
        self,
        *,
        organization_id: str,
        task_id: Optional[str] = None,
        model: Optional[str] = None,
        reported_cost_usd: float,
    ) -> str:
        """
        Triggers a critical security/cost alert when OpenRouter reports a nonzero cost
        during zero-cost execution, halting all subsequent cloud requests for the organization.
        """
        org_ledger = self._get_org_ledger(organization_id)
        detail = (
            f"CRITICAL_ZERO_COST_ALERT: Nonzero inference cost (${reported_cost_usd:.8f}) "
            f"reported for model '{model or 'unknown'}' on task '{task_id or 'n/a'}'. "
            "All subsequent cloud requests are halted immediately."
        )
        org_ledger.nonzero_cost_alert_triggered = True
        org_ledger.nonzero_cost_alert_detail = detail
        org_ledger.rate_limit_status = "HALTED_NONZERO_COST_ALERT"
        logger.critical(detail)
        return detail

    def record_rejected_paid_request(
        self,
        *,
        organization_id: str = "default-org",
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        model: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> None:
        org_ledger = self._get_org_ledger(organization_id)
        org_ledger.rejected_paid_model_requests += 1
        if task_id:
            task_ledger = self._get_task_ledger(organization_id, task_id)
            task_ledger.rejected_paid_model_requests += 1
        if agent_id:
            agent_ledger = self._get_agent_ledger(organization_id, agent_id)
            agent_ledger.rejected_paid_model_requests += 1
        logger.warning(
            f"Rejected paid/unverified model request for org='{organization_id}', "
            f"task='{task_id}', model='{model}': {reason}"
        )

    def record_rate_limit_failure(
        self,
        *,
        organization_id: str = "default-org",
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        model: Optional[str] = None,
        retry_after_seconds: Optional[float] = None,
    ) -> None:
        org_ledger = self._get_org_ledger(organization_id)
        org_ledger.rate_limit_failures += 1
        if not org_ledger.nonzero_cost_alert_triggered:
            org_ledger.rate_limit_status = (
                f"RATE_LIMITED (Retry-After: {retry_after_seconds}s)"
                if retry_after_seconds is not None
                else "RATE_LIMITED"
            )
        if task_id:
            task_ledger = self._get_task_ledger(organization_id, task_id)
            task_ledger.rate_limit_failures += 1
        if agent_id:
            agent_ledger = self._get_agent_ledger(organization_id, agent_id)
            agent_ledger.rate_limit_failures += 1

    def check_cloud_budget(
        self,
        *,
        organization_id: str = "default-org",
        task_id: Optional[str] = None,
        estimated_prompt_tokens: int = 0,
        model: Optional[str] = None,
        max_task_cloud_cost_usd: Optional[float] = None,
        max_org_daily_cloud_cost_usd: Optional[float] = None,
        max_org_monthly_cloud_cost_usd: Optional[float] = None,
        max_task_cloud_requests: Optional[int] = None,
        max_org_daily_cloud_requests: Optional[int] = None,
        max_tokens_per_request: Optional[int] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Pre-flight check before routing a request to a cloud provider.
        Returns (allowed: bool, rejection_reason: Optional[str]).
        """
        org_ledger = self._get_org_ledger(organization_id)
        if org_ledger.nonzero_cost_alert_triggered:
            return (
                False,
                org_ledger.nonzero_cost_alert_detail
                or "CRITICAL_ZERO_COST_ALERT: Subsequent cloud requests halted due to nonzero cost alert.",
            )

        eff_task_cost_cap = (
            settings.MAX_TASK_CLOUD_COST_USD
            if max_task_cloud_cost_usd is None
            else float(max_task_cloud_cost_usd)
        )
        eff_org_daily_cap = (
            settings.MAX_ORGANIZATION_DAILY_CLOUD_COST_USD
            if max_org_daily_cloud_cost_usd is None
            else float(max_org_daily_cloud_cost_usd)
        )
        eff_org_monthly_cap = (
            settings.MAX_ORGANIZATION_MONTHLY_CLOUD_COST_USD
            if max_org_monthly_cloud_cost_usd is None
            else float(max_org_monthly_cloud_cost_usd)
        )
        eff_task_req_cap = (
            settings.MAX_TASK_CLOUD_REQUESTS
            if max_task_cloud_requests is None
            else int(max_task_cloud_requests)
        )
        eff_org_daily_req_cap = (
            settings.MAX_ORGANIZATION_DAILY_CLOUD_REQUESTS
            if max_org_daily_cloud_requests is None
            else int(max_org_daily_cloud_requests)
        )
        eff_req_token_cap = (
            settings.MAX_TOKENS_PER_REQUEST
            if max_tokens_per_request is None
            else int(max_tokens_per_request)
        )

        if eff_req_token_cap > 0 and estimated_prompt_tokens > eff_req_token_cap:
            return (
                False,
                f"Request token count ({estimated_prompt_tokens}) exceeds MAX_TOKENS_PER_REQUEST ({eff_req_token_cap}).",
            )

        if eff_org_daily_req_cap > 0 and org_ledger.daily_cloud_requests >= eff_org_daily_req_cap:
            org_ledger.rate_limit_status = "DAILY_QUOTA_EXHAUSTED"
            return (
                False,
                f"Organization '{organization_id}' daily cloud request budget exhausted "
                f"({org_ledger.daily_cloud_requests}/{eff_org_daily_req_cap}).",
            )

        projected_min_cost = estimate_llm_cost_usd(
            model=model or settings.LLM_CLOUD_MODEL,
            prompt_tokens=max(1, estimated_prompt_tokens),
            completion_tokens=64,
            is_local=False,
        )

        if eff_org_daily_cap > 0 and (
            org_ledger.daily_cloud_cost_usd >= eff_org_daily_cap
            or (org_ledger.daily_cloud_cost_usd + projected_min_cost) > eff_org_daily_cap
        ):
            return (
                False,
                f"Organization '{organization_id}' daily cloud budget exhausted "
                f"(${org_ledger.daily_cloud_cost_usd:.6f} / ${eff_org_daily_cap:.6f}).",
            )

        if eff_org_monthly_cap > 0 and (
            org_ledger.monthly_cloud_cost_usd >= eff_org_monthly_cap
            or (org_ledger.monthly_cloud_cost_usd + projected_min_cost) > eff_org_monthly_cap
        ):
            return (
                False,
                f"Organization '{organization_id}' monthly cloud budget exhausted "
                f"(${org_ledger.monthly_cloud_cost_usd:.6f} / ${eff_org_monthly_cap:.6f}).",
            )

        if task_id:
            task_ledger = self._get_task_ledger(organization_id, task_id)
            if eff_task_req_cap > 0 and task_ledger.cloud_requests >= eff_task_req_cap:
                return (
                    False,
                    f"Task '{task_id}' reached MAX_TASK_CLOUD_REQUESTS ({task_ledger.cloud_requests}/{eff_task_req_cap}).",
                )
            if eff_task_cost_cap > 0 and (
                task_ledger.cloud_cost_usd >= eff_task_cost_cap
                or (task_ledger.cloud_cost_usd + projected_min_cost) > eff_task_cost_cap
            ):
                return (
                    False,
                    f"Task '{task_id}' cloud cost budget exhausted "
                    f"(${task_ledger.cloud_cost_usd:.6f} / ${eff_task_cost_cap:.6f}).",
                )

        return (True, None)

    def record_usage(
        self,
        *,
        usage: LLMUsage,
        is_cloud: bool,
        organization_id: str = "default-org",
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        enforce_zero_cost: bool = False,
    ) -> Dict[str, Any]:
        """
        Records actual or estimated token and USD cost usage after an LLM call.
        For verified free inference: actual_inference_cost_usd = 0.0.
        If OpenRouter reports a nonzero cost during zero-cost enforcement, halts cloud requests
        immediately and raises LLMBudgetExceededError.
        """
        p_tokens = max(0, int(usage.prompt_tokens or 0))
        c_tokens = max(0, int(usage.completion_tokens or 0))
        t_tokens = max(0, int(usage.total_tokens or (p_tokens + c_tokens)))

        model_str = str(usage.model or "").lower().strip()
        is_free_call = bool(
            not is_cloud
            or usage.is_free_model
            or model_str.endswith(":free")
            or enforce_zero_cost
        )

        if is_cloud:
            if usage.actual_cost_usd is not None:
                cost_usd = round(max(0.0, float(usage.actual_cost_usd)), 8)
                actual_inf_cost = cost_usd
                est_inf_cost = 0.0
                is_estimated = False
            elif is_free_call:
                cost_usd = 0.0
                actual_inf_cost = 0.0
                est_inf_cost = 0.0
                is_estimated = False
            else:
                cost_usd = round(max(0.0, float(usage.estimated_cost_usd or 0.0)), 8)
                actual_inf_cost = 0.0
                est_inf_cost = cost_usd
                is_estimated = True
        else:
            cost_usd = 0.0
            actual_inf_cost = 0.0
            est_inf_cost = 0.0
            is_estimated = False

        org_ledger = self._get_org_ledger(organization_id)
        org_ledger.total_tokens += t_tokens
        if is_cloud:
            org_ledger.daily_cloud_requests += 1
            org_ledger.monthly_cloud_requests += 1
            org_ledger.daily_cloud_cost_usd = round(org_ledger.daily_cloud_cost_usd + cost_usd, 8)
            org_ledger.monthly_cloud_cost_usd = round(org_ledger.monthly_cloud_cost_usd + cost_usd, 8)
            org_ledger.actual_inference_cost_usd = round(
                org_ledger.actual_inference_cost_usd + actual_inf_cost, 8
            )
            org_ledger.estimated_inference_cost_usd = round(
                org_ledger.estimated_inference_cost_usd + est_inf_cost, 8
            )
            if is_free_call and cost_usd == 0.0:
                org_ledger.free_model_requests += 1
            if not org_ledger.nonzero_cost_alert_triggered:
                org_ledger.rate_limit_status = "OK"

        if task_id:
            task_ledger = self._get_task_ledger(organization_id, task_id)
            task_ledger.prompt_tokens += p_tokens
            task_ledger.completion_tokens += c_tokens
            task_ledger.total_tokens += t_tokens
            if is_cloud:
                task_ledger.cloud_requests += 1
                task_ledger.cloud_cost_usd = round(task_ledger.cloud_cost_usd + cost_usd, 8)
                task_ledger.actual_inference_cost_usd = round(
                    task_ledger.actual_inference_cost_usd + actual_inf_cost, 8
                )
                task_ledger.estimated_inference_cost_usd = round(
                    task_ledger.estimated_inference_cost_usd + est_inf_cost, 8
                )
                if is_free_call and cost_usd == 0.0:
                    task_ledger.free_model_requests += 1
                if is_estimated:
                    task_ledger.estimated_cloud_cost_usd = round(
                        task_ledger.estimated_cloud_cost_usd + cost_usd, 8
                    )
                else:
                    task_ledger.actual_cloud_cost_usd = round(
                        task_ledger.actual_cloud_cost_usd + cost_usd, 8
                    )
            else:
                task_ledger.local_requests += 1

        if agent_id:
            agent_ledger = self._get_agent_ledger(organization_id, agent_id)
            agent_ledger.prompt_tokens += p_tokens
            agent_ledger.completion_tokens += c_tokens
            agent_ledger.total_tokens += t_tokens
            if is_cloud:
                agent_ledger.cloud_requests += 1
                agent_ledger.cloud_cost_usd = round(agent_ledger.cloud_cost_usd + cost_usd, 8)
                agent_ledger.actual_inference_cost_usd = round(
                    agent_ledger.actual_inference_cost_usd + actual_inf_cost, 8
                )
                agent_ledger.estimated_inference_cost_usd = round(
                    agent_ledger.estimated_inference_cost_usd + est_inf_cost, 8
                )
                if is_free_call and cost_usd == 0.0:
                    agent_ledger.free_model_requests += 1
            else:
                agent_ledger.local_requests += 1

        # Critical Zero-Cost Circuit Breaker: if nonzero cost is reported when zero-cost is expected
        if is_cloud and (enforce_zero_cost or usage.is_free_model or model_str.endswith(":free")) and cost_usd > 0.0:
            alert_msg = self.trigger_nonzero_cost_alert(
                organization_id=organization_id,
                task_id=task_id,
                model=usage.model,
                reported_cost_usd=cost_usd,
            )
            raise LLMBudgetExceededError(alert_msg)

        return {
            "organization_id": org_ledger.organization_id,
            "is_cloud": is_cloud,
            "is_free_model": is_free_call and cost_usd == 0.0,
            "cost_usd": cost_usd,
            "actual_inference_cost_usd": actual_inf_cost,
            "estimated_inference_cost_usd": est_inf_cost,
            "is_estimated_cost": is_estimated,
            "org_daily_cloud_cost_usd": org_ledger.daily_cloud_cost_usd,
            "org_monthly_cloud_cost_usd": org_ledger.monthly_cloud_cost_usd,
        }

    def get_organization_summary(self, organization_id: str) -> Dict[str, Any]:
        org_key = (organization_id or "default-org").strip()
        org_ledger = self._get_org_ledger(org_key)
        tasks = {
            t_id: ledger.model_dump()
            for (o_id, t_id), ledger in self._task_ledgers.items()
            if o_id == org_key
        }
        agents = {
            a_id: ledger.model_dump()
            for (o_id, a_id), ledger in self._agent_ledgers.items()
            if o_id == org_key
        }
        return {
            "organization": org_ledger.model_dump(),
            "limits": {
                "max_task_cloud_cost_usd": settings.MAX_TASK_CLOUD_COST_USD,
                "max_organization_daily_cloud_cost_usd": settings.MAX_ORGANIZATION_DAILY_CLOUD_COST_USD,
                "max_organization_monthly_cloud_cost_usd": settings.MAX_ORGANIZATION_MONTHLY_CLOUD_COST_USD,
                "max_task_cloud_requests": settings.MAX_TASK_CLOUD_REQUESTS,
                "max_organization_daily_cloud_requests": settings.MAX_ORGANIZATION_DAILY_CLOUD_REQUESTS,
                "max_tokens_per_request": settings.MAX_TOKENS_PER_REQUEST,
            },
            "tasks": tasks,
            "agents": agents,
        }

    def reset(self) -> None:
        self._org_ledgers.clear()
        self._task_ledgers.clear()
        self._agent_ledgers.clear()


default_cost_controller = CloudCostController()
