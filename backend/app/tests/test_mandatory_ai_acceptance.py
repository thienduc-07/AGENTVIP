import pytest
import asyncio
from backend.app.core.database import SessionLocal
from backend.app.services.conversation_service import conversation_service

@pytest.mark.asyncio
async def test_acceptance_a_math_exponent():
    """Test A: '1 mũ 1000000' -> Returns 1 with mathematical explanation, no mock stub."""
    db = SessionLocal()
    try:
        res = await conversation_service.process_chat(db, prompt="1 mũ 1000000")
        assert "1" in res["content"]
        assert "tiếp nhận và xử lý theo quy trình chuyên môn" not in res["content"]
        assert res["routing"]["provider"] == "fast-math-eval"
    finally:
        db.close()

@pytest.mark.asyncio
async def test_acceptance_b_architectural_analysis():
    """Test B: Comprehensive system architecture review and optimization."""
    db = SessionLocal()
    try:
        res = await conversation_service.process_chat(
            db, prompt="Phân tích toàn bộ kiến trúc hệ thống hiện tại và đề xuất cách tối ưu."
        )
        assert "tiếp nhận và xử lý theo quy trình chuyên môn" not in res["content"]
        assert "Kiến Trúc" in res["content"]
        assert "Tối Ưu" in res["content"] or "tối ưu" in res["content"]
        assert "Three.js" in res["content"] or "FastAPI" in res["content"]
    finally:
        db.close()

@pytest.mark.asyncio
async def test_acceptance_c_hrm_task_and_recruited_specialists():
    """Test C: HRM application build, task mode, recruited specialists only."""
    db = SessionLocal()
    try:
        res = await conversation_service.process_chat(
            db, prompt="Xây dựng một ứng dụng quản lý nhân sự hoàn chỉnh.", mode="task"
        )
        assert res["mode"] == "task"
        assert res["task_id"] is not None
        assert "tiếp nhận và xử lý theo quy trình chuyên môn" not in res["content"]
        assert "David Chen" in res["content"] or "Sophia Taylor" in res["content"]
        assert "Database Schema" in res["content"] or "hrm_departments" in res["content"]
    finally:
        db.close()

@pytest.mark.asyncio
async def test_acceptance_d_code_synthesis():
    """Test D: Multi-step programming prompt -> Working code."""
    db = SessionLocal()
    try:
        res = await conversation_service.process_chat(
            db, prompt="Viết code triển khai thuật toán A* tìm đường ngắn nhất"
        )
        assert "tiếp nhận và xử lý theo quy trình chuyên môn" not in res["content"]
        assert "class AStarGrid" in res["content"] or "def find_path" in res["content"]
        assert "```python" in res["content"]
    finally:
        db.close()

@pytest.mark.asyncio
async def test_acceptance_e_resilience_and_state_machine():
    """Test E: Execution state machine trace and graceful fallback."""
    db = SessionLocal()
    try:
        res = await conversation_service.process_chat(
            db, prompt="Kiểm tra phân tích bảo mật hệ thống API"
        )
        assert "thought" in res and res["thought"]
        assert "RECEIVED" in res["thought"] or "COMPLETED" in res["thought"]
        assert "tiếp nhận và xử lý theo quy trình chuyên môn" not in res["content"]
    finally:
        db.close()

