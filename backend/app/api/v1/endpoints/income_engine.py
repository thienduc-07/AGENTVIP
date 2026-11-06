import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, status, HTTPException, Body
from pydantic import BaseModel

from backend.app.services.autonomous_income_engine import autonomous_income_engine

logger = logging.getLogger("agency.api.income")

router = APIRouter(prefix="/income", tags=["Autonomous Work & Legal Income Engine"])

class SettleContractRequest(BaseModel):
    job_id: Optional[str] = None

@router.get("/overview", status_code=status.HTTP_200_OK)
def get_income_overview() -> Dict[str, Any]:
    """
    Truy vấn báo cáo Máy Kiếm Tiền Tự Động (Autonomous Work & Legal Income Engine).
    Hiển thị tổng số tiền đã kiếm hợp pháp, trạng thái payout về MB Bank (01993667799 - LE THIEN DUC).
    """
    return autonomous_income_engine.get_overview()

@router.get("/jobs", status_code=status.HTTP_200_OK)
def list_freelance_jobs() -> List[Dict[str, Any]]:
    """
    Danh sách các dự án đang rảo/săn trên Upwork, Freelancer, GitHub Bounties, RemoteOK.
    """
    return autonomous_income_engine.list_jobs()

@router.post("/scan-jobs", status_code=status.HTTP_200_OK)
def trigger_jobs_scan() -> List[Dict[str, Any]]:
    """
    Kích hoạt tiến trình quét dự án tự động trên các nền tảng mạng và tạo Proposal chuyên môn.
    """
    return autonomous_income_engine.scan_for_new_opportunities()

@router.post("/settle-contract", status_code=status.HTTP_200_OK)
def settle_job_contract(payload: SettleContractRequest) -> Dict[str, Any]:
    """
    Bàn giao sản phẩm số hợp pháp, nghiệm thu và chuyển khoản thu nhập về tài khoản MB Bank 01993667799.
    """
    return autonomous_income_engine.execute_and_settle_contract(payload.job_id or "")

@router.get("/affiliate", status_code=status.HTTP_200_OK)
def list_affiliate_campaigns() -> List[Dict[str, Any]]:
    """
    Danh sách các chiến dịch tiếp thị liên kết công nghệ (SaaS, Cloud, Dev Tools, Phần cứng) hợp pháp.
    """
    return autonomous_income_engine.list_affiliate_campaigns()

