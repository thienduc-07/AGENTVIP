"""
PROVIPAGENT Production Performance & Load Benchmark Engine
Measures P50, P95, P99 latency percentiles and error rates across critical API endpoints and WebSockets.
"""

import sys
import os
import time
import math
import statistics
from typing import List, Dict, Any, Tuple
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.auth import create_access_token


CRITICAL_ENDPOINTS = [
    ("/api/v1/agents", "GET"),
    ("/api/v1/tasks", "GET"),
    ("/api/v1/workstations/overview", "GET"),
    ("/api/v1/health/readiness", "GET"),
]

CONCURRENCY_LEVELS = [1, 5, 10, 20, 50]


def get_percentile(sorted_data: List[float], percentile: float) -> float:
    """Calculates percentile from sorted float list."""
    if not sorted_data:
        return 0.0
    k = (len(sorted_data) - 1) * (percentile / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_data[int(k)]
    d0 = sorted_data[int(f)] * (c - k)
    d1 = sorted_data[int(c)] * (k - f)
    return d0 + d1


def calculate_percentiles(latencies_ms: List[float]) -> Dict[str, float]:
    """Calculates min, max, mean, p50, p95, and p99 from a latency array."""
    if not latencies_ms:
        return {"min": 0.0, "max": 0.0, "mean": 0.0, "p50": 0.0, "p95": 0.0, "p99": 0.0}
    sorted_data = sorted(latencies_ms)
    return {
        "min": round(min(sorted_data), 2),
        "max": round(max(sorted_data), 2),
        "mean": round(statistics.mean(sorted_data), 2),
        "p50": round(get_percentile(sorted_data, 50), 2),
        "p95": round(get_percentile(sorted_data, 95), 2),
        "p99": round(get_percentile(sorted_data, 99), 2),
    }


def run_endpoint_benchmark(
    client: TestClient,
    endpoint: str,
    headers: Dict[str, str],
    total_requests: int = 50,
) -> Dict[str, Any]:
    """Benchmarks an individual HTTP endpoint over N serial or rapid requests."""
    latencies = []
    status_codes = []
    errors = 0

    for _ in range(total_requests):
        t0 = time.perf_counter()
        try:
            resp = client.get(endpoint, headers=headers)
            latencies.append((time.perf_counter() - t0) * 1000)
            status_codes.append(resp.status_code)
            if resp.status_code != 200:
                errors += 1
        except Exception:
            errors += 1
            latencies.append((time.perf_counter() - t0) * 1000)

    stats = calculate_percentiles(latencies)
    return {
        "endpoint": endpoint,
        "total_requests": total_requests,
        "successful_requests": total_requests - errors,
        "error_rate": errors / total_requests,
        "stats": stats,
    }


def run_websocket_benchmark(
    client: TestClient,
    token: str,
    iterations: int = 20,
) -> Dict[str, Any]:
    """Benchmarks WebSocket connection establishment and roundtrip heartbeat/echo latency."""
    latencies = []
    errors = 0

    for _ in range(iterations):
        t0 = time.perf_counter()
        try:
            with client.websocket_connect(f"/ws?token={token}") as ws:
                # Connection established
                connect_time = (time.perf_counter() - t0) * 1000
                latencies.append(connect_time)

                # Send ping
                t_ping = time.perf_counter()
                ws.send_text('{"type": "ping", "data": {}}')
                # Receive pong
                msg = ws.receive_text()
                pong_latency = (time.perf_counter() - t_ping) * 1000
                assert "pong" in msg or "PONG" in msg or "snapshot" in msg or "heartbeat" in msg
        except Exception as e:
            errors += 1

    stats = calculate_percentiles(latencies)
    return {
        "benchmark": "websocket_connect_and_ping",
        "iterations": iterations,
        "successful": iterations - errors,
        "error_rate": errors / iterations,
        "connect_latency_stats": stats,
    }


def run_full_benchmark() -> Dict[str, Any]:
    """Executes comprehensive benchmark suite across all critical endpoints."""
    client = TestClient(app)
    token = create_access_token(
        user_id="usr-platform-superadmin",
        email="admin@agency.ai",
        is_superadmin=True,
        org_roles={"org_default_company": "admin"},
        token_version=1,
    )
    headers = {"Authorization": f"Bearer {token}"}

    results = {}
    print("=" * 70)
    print("PROVIPAGENT PRODUCTION LOAD & PERFORMANCE BENCHMARK")
    print("=" * 70)

    for endpoint, method in CRITICAL_ENDPOINTS:
        res = run_endpoint_benchmark(client, endpoint, headers, total_requests=50)
        results[endpoint] = res
        p = res["stats"]
        print(f"Endpoint: {endpoint}")
        print(f"  Requests: {res['total_requests']} | Errors: {res['error_rate'] * 100:.1f}%")
        print(f"  P50: {p['p50']}ms | P95: {p['p95']}ms | P99: {p['p99']}ms | Mean: {p['mean']}ms")
        print("-" * 70)

    ws_res = run_websocket_benchmark(client, token, iterations=20)
    results["websocket"] = ws_res
    ws_p = ws_res["connect_latency_stats"]
    print("WebSocket Performance:")
    print(f"  Iterations: {ws_res['iterations']} | Errors: {ws_res['error_rate'] * 100:.1f}%")
    print(f"  Connect P50: {ws_p['p50']}ms | P95: {ws_p['p95']}ms | P99: {ws_p['p99']}ms")
    print("=" * 70)

    return results


if __name__ == "__main__":
    run_full_benchmark()
