import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, status, HTTPException, Body
from pydantic import BaseModel, Field

from backend.app.services.monetization_service import monetization_service

logger = logging.getLogger("agency.api.monetization")

router = APIRouter(prefix="/monetization", tags=["Monetization & Treasury"])

class CreateOrderRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    deliverable_type: str = Field("web_app", description="web_app, landing_page, analytics_report, api_service, hrm_suite")
    price_vnd: int = Field(..., gt=0, description="Giá trị thanh toán bằng VND (tối thiểu 10.000 VND)")
    description: Optional[str] = Field("", max_length=1000)
    client_name: Optional[str] = Field("Khách Hàng Doanh Nghiệp", max_length=150)
    assigned_agent_id: Optional[str] = Field("agent-eng-lead")
    assigned_agent_name: Optional[str] = Field("David Chen")
    department: Optional[str] = Field("engineering")

class UpdateBankConfigRequest(BaseModel):
    bank_id: Optional[str] = None
    bank_name: Optional[str] = None
    bank_bin: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None
    auto_payout_enabled: Optional[bool] = None
    payout_note: Optional[str] = None

class WebhookPaymentRequest(BaseModel):
    order_id: Optional[str] = None
    amount: Optional[int] = None
    transaction_id: Optional[str] = None
    content: Optional[str] = None
    reference: Optional[str] = None
    auto_match_first_pending: Optional[bool] = False

@router.get("/treasury", status_code=status.HTTP_200_OK)
def get_treasury_overview() -> Dict[str, Any]:
    """
    Truy vấn báo cáo Sổ Cái Doanh Thu & Ngân Khố Thực Tế (Executive Treasury Dashboard).
    Hiển thị tổng doanh thu VND/USD, số tiền đã chuyển khoản về ngân hàng, và bảng xếp hạng chuyên gia tạo doanh số.
    """
    return monetization_service.get_treasury_metrics()

@router.get("/orders", status_code=status.HTTP_200_OK)
def list_commercial_orders() -> List[Dict[str, Any]]:
    """
    Danh sách các đơn hàng thương mại / hợp đồng sản phẩm số đã khởi tạo kèm mã Napas247 VietQR.
    """
    return monetization_service.list_orders()

@router.post("/orders", status_code=status.HTTP_201_CREATED)
def create_commercial_order(payload: CreateOrderRequest) -> Dict[str, Any]:
    """
    Đóng gói nhiệm vụ AI thành Đơn Hàng Thương Mại và phát hành mã VietQR Napas247 tự động.
    """
    try:
        return monetization_service.create_order(
            title=payload.title,
            deliverable_type=payload.deliverable_type,
            price_vnd=payload.price_vnd,
            description=payload.description or "",
            client_name=payload.client_name or "Khách Hàng Trực Tuyến",
            assigned_agent_id=payload.assigned_agent_id or "agent-eng-lead",
            assigned_agent_name=payload.assigned_agent_name or "David Chen",
            department=payload.department or "engineering",
        )
    except Exception as e:
        logger.error(f"Error creating commercial order: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khởi tạo đơn hàng: {str(e)}"
        )

@router.get("/config", status_code=status.HTTP_200_OK)
def get_bank_payout_config() -> Dict[str, Any]:
    """
    Lấy thông tin tài khoản ngân hàng nhận tiền thật hiện tại (Napas247 VietQR).
    """
    return monetization_service.get_payout_config()

@router.post("/config", status_code=status.HTTP_200_OK)
def update_bank_payout_config(payload: UpdateBankConfigRequest) -> Dict[str, Any]:
    """
    Cập nhật số tài khoản ngân hàng, tên ngân hàng và chủ tài khoản nhận tiền thật.
    """
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    return monetization_service.update_payout_config(data)

@router.post("/webhook", status_code=status.HTTP_200_OK)
def payment_webhook_listener(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Điểm cuối tiếp nhận Webhook thanh toán từ SePay / PayOS / Casso / Stripe hoặc giả lập.
    Khi giao dịch thành công, tiền được tự động ghi nhận vào Sổ cái và phát tín hiệu ăn mừng tới Diorama 3D.
    """
    result = monetization_service.process_payment_webhook(payload)
    if result.get("status") != "SUCCESS":
        return result
    return result

@router.post("/simulate-payment", status_code=status.HTTP_200_OK)
def simulate_client_payment(order_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Thực hiện thanh toán thử nghiệm cho đơn hàng (để kiểm tra luồng Webhook và hiệu ứng ăn mừng trên 3D).
    """
    payload = {
        "order_id": order_id,
        "auto_match_first_pending": True if not order_id else False,
        "transaction_id": f"TEST-TX-{order_id or 'AUTO'}",
    }
    return monetization_service.process_payment_webhook(payload)

