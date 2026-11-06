import json
import os
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger("agency.monetization")

LEDGER_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "monetization_ledger.json")

class BankPayoutConfig(BaseModel):
    bank_id: str = "MB"  # e.g., MB, VCB, TCB, ACB, BIDV
    bank_name: str = "MB Bank (Ngân Hàng Quân Đội)"
    bank_bin: str = "970422"
    account_number: str = "01993667799"
    account_name: str = "LE THIEN DUC"
    auto_payout_enabled: bool = True
    webhook_secret: Optional[str] = "sepay_sec_provipagent_2026"
    payout_note: str = "PROVIPAGENT AI DELIVERABLE REVENUE"

class CommercialOrder(BaseModel):
    id: str = Field(default_factory=lambda: f"ORD-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}")
    title: str
    deliverable_type: str  # web_app, landing_page, analytics_report, api_service, hrm_suite
    description: str
    price_vnd: int
    price_usd: float
    status: str = "PENDING_PAYMENT"  # PENDING_PAYMENT, PAYMENT_CONFIRMED, SETTLED_TO_BANK, CANCELLED
    client_name: str = "Khách Hàng Doanh Nghiệp"
    assigned_agent_id: str
    assigned_agent_name: str
    department: str = "engineering"
    vietqr_url: str = ""
    client_preview_url: str = ""
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    settled_at: Optional[str] = None
    transaction_ref: Optional[str] = None

class MonetizationService:
    def __init__(self):
        os.makedirs(os.path.dirname(LEDGER_PATH), exist_ok=True)
        self._load_or_init_ledger()

    def _load_or_init_ledger(self):
        if not os.path.exists(LEDGER_PATH):
            default_config = BankPayoutConfig().model_dump()
            sample_orders = [
                CommercialOrder(
                    id="ORD-20261107-HRM01",
                    title="Gói Phần Mềm Quản Trị Nhân Sự Doanh Nghiệp HRM Suite",
                    deliverable_type="hrm_suite",
                    description="Hệ thống quản lý nhân sự hoàn chỉnh: DDL SQL, FastAPI Backend, 3D Dashboard & Module Chấm Công.",
                    price_vnd=25000000,
                    price_usd=1000.0,
                    status="PAYMENT_CONFIRMED",
                    client_name="Tập Đoàn Công Nghệ V-Star",
                    assigned_agent_id="agent-eng-lead",
                    assigned_agent_name="David Chen",
                    department="engineering",
                    transaction_ref="FT263129849204",
                    settled_at=datetime.utcnow().isoformat(),
                ).model_dump(),
                CommercialOrder(
                    id="ORD-20261107-SEO02",
                    title="Chiến Dịch Tăng Trưởng Doanh Số & Landing Page AI Conversion",
                    deliverable_type="landing_page",
                    description="Trang đích bán hàng tối ưu chuyển đổi cao kèm bộ công cụ đo lường tự động.",
                    price_vnd=15000000,
                    price_usd=600.0,
                    status="SETTLED_TO_BANK",
                    client_name="Chuỗi Bán Lẻ EcoFresh",
                    assigned_agent_id="agent-mkt-growth",
                    assigned_agent_name="Sophia Martinez",
                    department="marketing",
                    transaction_ref="FT263129849205",
                    settled_at=datetime.utcnow().isoformat(),
                ).model_dump(),
            ]
            # Generate VietQR URLs for sample orders
            bank_id = default_config["bank_id"]
            acc_num = default_config["account_number"]
            acc_name = default_config["account_name"]
            for o in sample_orders:
                o["vietqr_url"] = self._build_vietqr_url(bank_id, acc_num, acc_name, o["price_vnd"], o["id"])
                o["client_preview_url"] = f"/invoices/{o['id']}"

            data = {
                "config": default_config,
                "orders": sample_orders,
                "updated_at": datetime.utcnow().isoformat()
            }
            with open(LEDGER_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

    def _read_ledger(self) -> Dict[str, Any]:
        try:
            with open(LEDGER_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            self._load_or_init_ledger()
            with open(LEDGER_PATH, "r", encoding="utf-8") as f:
                return json.load(f)

    def _save_ledger(self, data: Dict[str, Any]):
        data["updated_at"] = datetime.utcnow().isoformat()
        with open(LEDGER_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _build_vietqr_url(self, bank_id: str, account_number: str, account_name: str, amount_vnd: int, order_code: str) -> str:
        import urllib.parse
        encoded_name = urllib.parse.quote(account_name)
        return (
            f"https://img.vietqr.io/image/{bank_id}-{account_number}-compact2.png"
            f"?amount={amount_vnd}&addInfo={order_code}&accountName={encoded_name}"
        )

    def get_payout_config(self) -> Dict[str, Any]:
        ledger = self._read_ledger()
        return ledger.get("config", BankPayoutConfig().model_dump())

    def update_payout_config(self, new_config: Dict[str, Any]) -> Dict[str, Any]:
        ledger = self._read_ledger()
        cfg = ledger.get("config", BankPayoutConfig().model_dump())
        for k in ["bank_id", "bank_name", "bank_bin", "account_number", "account_name", "auto_payout_enabled", "payout_note"]:
            if k in new_config and str(new_config[k]).strip():
                cfg[k] = new_config[k]
        ledger["config"] = cfg

        # Re-generate VietQR for pending orders with new bank details
        for o in ledger.get("orders", []):
            if o.get("status") == "PENDING_PAYMENT":
                o["vietqr_url"] = self._build_vietqr_url(
                    cfg["bank_id"], cfg["account_number"], cfg["account_name"], o["price_vnd"], o["id"]
                )

        self._save_ledger(ledger)
        return cfg

    def create_order(
        self,
        title: str,
        deliverable_type: str,
        price_vnd: int,
        description: str = "",
        client_name: str = "Khách Hàng Trực Tuyến",
        assigned_agent_id: str = "agent-eng-lead",
        assigned_agent_name: str = "David Chen",
        department: str = "engineering",
    ) -> Dict[str, Any]:
        ledger = self._read_ledger()
        cfg = ledger.get("config", BankPayoutConfig().model_dump())

        order_id = f"ORD-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        price_usd = round(price_vnd / 25000.0, 2)
        vietqr_url = self._build_vietqr_url(
            cfg["bank_id"], cfg["account_number"], cfg["account_name"], price_vnd, order_id
        )

        order = {
            "id": order_id,
            "title": title,
            "deliverable_type": deliverable_type,
            "description": description or f"Sản phẩm số tự động tạo bởi {assigned_agent_name}.",
            "price_vnd": price_vnd,
            "price_usd": price_usd,
            "status": "PENDING_PAYMENT",
            "client_name": client_name,
            "assigned_agent_id": assigned_agent_id,
            "assigned_agent_name": assigned_agent_name,
            "department": department,
            "vietqr_url": vietqr_url,
            "client_preview_url": f"/invoices/{order_id}",
            "created_at": datetime.utcnow().isoformat(),
            "settled_at": None,
            "transaction_ref": None,
        }

        ledger.setdefault("orders", []).insert(0, order)
        self._save_ledger(ledger)

        # Broadcast order creation event
        try:
            from backend.app.websocket_manager import ws_manager
            ws_manager.broadcast_sync({
                "schema_version": 1,
                "event_id": f"ord_create_{uuid.uuid4().hex[:8]}",
                "event_type": "commercial_order_created",
                "occurred_at": datetime.utcnow().isoformat(),
                "sequence_id": None,
                "agent_id": assigned_agent_id,
                "task_id": None,
                "payload": order,
            })
        except Exception:
            pass

        return order

    def list_orders(self) -> List[Dict[str, Any]]:
        ledger = self._read_ledger()
        return ledger.get("orders", [])

    def process_payment_webhook(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Receives webhook confirmation from SePay / PayOS / Casso / Stripe or manual trigger.
        Matches order ID in transaction content, transitions status, and credits Treasury ledger.
        """
        ledger = self._read_ledger()
        orders = ledger.get("orders", [])

        # Try extract order reference
        content_str = json.dumps(payload).upper()
        matched_order = None

        for o in orders:
            if o["id"].upper() in content_str:
                matched_order = o
                break

        # Fallback to orderId in payload directly
        if not matched_order and "order_id" in payload:
            for o in orders:
                if o["id"].upper() == str(payload["order_id"]).upper():
                    matched_order = o
                    break

        if not matched_order and orders:
            # Match first pending order if specified in simulated test
            if payload.get("auto_match_first_pending"):
                for o in orders:
                    if o["status"] == "PENDING_PAYMENT":
                        matched_order = o
                        break

        if not matched_order:
            logger.warning(f"Payment webhook received but no order matched: {payload}")
            return {"status": "UNMATCHED", "message": "Không tìm thấy mã đơn hàng phù hợp trong nội dung chuyển khoản."}

        matched_order["status"] = "SETTLED_TO_BANK"
        matched_order["settled_at"] = datetime.utcnow().isoformat()
        matched_order["transaction_ref"] = payload.get("transaction_id") or payload.get("reference") or f"TX-{uuid.uuid4().hex[:10].upper()}"

        self._save_ledger(ledger)

        # Broadcast payment confirmation celebration event over WebSocket
        try:
            from backend.app.websocket_manager import ws_manager
            ws_manager.broadcast_sync({
                "schema_version": 1,
                "event_id": f"pay_conf_{uuid.uuid4().hex[:8]}",
                "event_type": "payment_confirmed",
                "occurred_at": datetime.utcnow().isoformat(),
                "sequence_id": None,
                "agent_id": matched_order.get("assigned_agent_id"),
                "task_id": None,
                "payload": {
                    "order_id": matched_order["id"],
                    "title": matched_order["title"],
                    "amount_vnd": matched_order["price_vnd"],
                    "agent_name": matched_order["assigned_agent_name"],
                    "department": matched_order["department"],
                    "status": "SETTLED_TO_BANK",
                    "bank_account": ledger.get("config", {}).get("account_number"),
                    "bank_name": ledger.get("config", {}).get("bank_name"),
                },
            })
        except Exception:
            pass

        return {
            "status": "SUCCESS",
            "message": f"Thanh toán đơn hàng {matched_order['id']} thành công! Tiền đã chuyển về tài khoản ngân hàng.",
            "order": matched_order,
        }

    def get_treasury_metrics(self) -> Dict[str, Any]:
        ledger = self._read_ledger()
        cfg = ledger.get("config", BankPayoutConfig().model_dump())
        orders = ledger.get("orders", [])

        total_rev_vnd = 0
        settled_rev_vnd = 0
        pending_rev_vnd = 0
        rev_by_agent: Dict[str, Dict[str, Any]] = {}
        rev_by_dept: Dict[str, int] = {}

        for o in orders:
            p = o.get("price_vnd", 0)
            status = o.get("status", "PENDING_PAYMENT")
            if status in ("PAYMENT_CONFIRMED", "SETTLED_TO_BANK"):
                total_rev_vnd += p
                settled_rev_vnd += p

                agent_id = o.get("assigned_agent_id", "unknown")
                agent_name = o.get("assigned_agent_name", "AI Specialist")
                dept = o.get("department", "engineering")

                if agent_id not in rev_by_agent:
                    rev_by_agent[agent_id] = {
                        "agent_id": agent_id,
                        "name": agent_name,
                        "department": dept,
                        "revenue_vnd": 0,
                        "deals_count": 0,
                    }
                rev_by_agent[agent_id]["revenue_vnd"] += p
                rev_by_agent[agent_id]["deals_count"] += 1
                rev_by_dept[dept] = rev_by_dept.get(dept, 0) + p
            elif status == "PENDING_PAYMENT":
                pending_rev_vnd += p

        sorted_agents = sorted(rev_by_agent.values(), key=lambda x: x["revenue_vnd"], reverse=True)

        return {
            "bank_config": cfg,
            "total_revenue_vnd": total_rev_vnd,
            "total_revenue_usd": round(total_rev_vnd / 25000.0, 2),
            "settled_to_bank_vnd": settled_rev_vnd,
            "pending_invoices_vnd": pending_rev_vnd,
            "orders_count": len(orders),
            "settled_count": len([o for o in orders if o.get("status") in ("PAYMENT_CONFIRMED", "SETTLED_TO_BANK")]),
            "pending_count": len([o for o in orders if o.get("status") == "PENDING_PAYMENT"]),
            "leaderboard": sorted_agents,
            "revenue_by_department": rev_by_dept,
            "recent_orders": orders[:10],
        }

monetization_service = MonetizationService()

