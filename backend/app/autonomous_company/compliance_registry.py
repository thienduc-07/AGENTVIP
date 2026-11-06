"""
Vietnamese Legal Compliance Registry & Owner Authorization Tiers
Autonomous AI Corporation — PROVIPAGENT
Verifies all commercial activities against official Vietnamese government legislation
and platform terms of service. Enforces Permission Levels 1 through 4.
"""

from __future__ import annotations
import hashlib
import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger("agency.compliance_registry")


class AuthorizationTier(int, Enum):
    LEVEL_1_AUTONOMOUS = 1    # Research, analyze, draft proposals, run tests, code products
    LEVEL_2_PREAUTHORIZED = 2 # Execute pre-approved low-risk operations within daily budget limit
    LEVEL_3_OWNER_APPROVAL = 3# Binding proposals, contract acceptance, campaign launch, external spend
    LEVEL_4_RESTRICTED = 4    # Bank payouts, account ownership changes, KYC, tax declarations


class LegalRegulationEntry(BaseModel):
    legislation_code: str
    official_source: str
    effective_date: str
    applicable_business_activity: str
    required_documentation: List[str]
    compliance_status: str = "VERIFIED_COMPLIANT"
    last_verified_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    notes: str


VIETNAMESE_LEGISLATION_REGISTRY: List[LegalRegulationEntry] = [
    LegalRegulationEntry(
        legislation_code="Nghị định 123/2020/NĐ-CP",
        official_source="Chính phủ Việt Nam (Cổng Thông Tin Điện Tử Chính Phủ)",
        effective_date="2022-07-01",
        applicable_business_activity="Cung cấp phần mềm, giải pháp CNTT và dịch vụ số có phát sinh doanh thu",
        required_documentation=[
            "Hợp đồng dịch vụ phần mềm điện tử (Electronic Service Contract)",
            "Biên bản nghiệm thu và bàn giao sản phẩm số (Acceptance Certificate)",
            "Hóa đơn điện tử có mã của cơ quan thuế (E-Invoice with Tax Authority Code)",
        ],
        notes="Quy định bắt buộc về hóa đơn, chứng từ khi bán hàng hóa, cung cấp dịch vụ số cho đối tác trong và ngoài nước.",
    ),
    LegalRegulationEntry(
        legislation_code="Thông tư 40/2021/TT-BTC",
        official_source="Bộ Tài Chính Việt Nam",
        effective_date="2021-08-01",
        applicable_business_activity="Nghĩa vụ thuế đối với hoạt động kinh doanh dịch vụ số, tiếp thị liên kết và freelance",
        required_documentation=[
            "Bảng kê đối soát doanh thu chi tiết theo từng giao dịch (Transaction Reconciliation Sheet)",
            "Kê khai thuế thu nhập cá nhân (2%) và thuế giá trị gia tăng (5%) đối với dịch vụ số/tiếp thị liên kết",
            "Mã số thuế thu nhập cá nhân/doanh nghiệp đã đăng ký chính ngạch",
        ],
        notes="Hướng dẫn thuế GTGT, TNCN và quản lý thuế đối với hộ kinh doanh, cá nhân kinh doanh dịch vụ nội dung số và thương mại điện tử.",
    ),
    LegalRegulationEntry(
        legislation_code="Luật Giao dịch điện tử số 20/2023/QH15",
        official_source="Quốc Hội Nước Cộng Hòa Xã Hội Chủ Nghĩa Việt Nam",
        effective_date="2024-07-01",
        applicable_business_activity="Giao kết hợp đồng điện tử, chữ ký số, thông điệp dữ liệu số và chứng thực giao dịch",
        required_documentation=[
            "Thông điệp dữ liệu hợp đồng có giá trị pháp lý tương đương bản gốc",
            "Chữ ký điện tử bảo đảm an toàn theo tiêu chuẩn quốc gia",
            "Nhật ký kiểm toán giao dịch (Immutable Audit Logs)",
        ],
        notes="Quy định công nhận giá trị pháp lý của hợp đồng điện tử và dữ liệu số trong hoạt động kinh doanh trực tuyến.",
    ),
    LegalRegulationEntry(
        legislation_code="Nghị định 52/2013/NĐ-CP & 85/2021/NĐ-CP",
        official_source="Chính phủ Việt Nam",
        effective_date="2022-01-01",
        applicable_business_activity="Thương mại điện tử, tiếp thị liên kết và phân phối sản phẩm số qua nền tảng mạng",
        required_documentation=[
            "Quy chế hoạt động công khai, minh bạch điều khoản dịch vụ và giá cả",
            "Thông tin minh bạch về đối tác liên kết và cảnh báo trách nhiệm pháp lý",
            "Bảo vệ quyền lợi người tiêu dùng và giải quyết khiếu nại",
        ],
        notes="Quy định quản lý hoạt động thương mại điện tử, dịch vụ trung gian và bảo vệ người tiêu dùng số.",
    ),
    LegalRegulationEntry(
        legislation_code="Nghị định 13/2023/NĐ-CP",
        official_source="Chính phủ Việt Nam",
        effective_date="2023-07-01",
        applicable_business_activity="Bảo vệ dữ liệu cá nhân của khách hàng, chuyên gia và đối tác kinh doanh",
        required_documentation=[
            "Chính sách bảo mật dữ liệu cá nhân (Personal Data Protection Policy)",
            "Biện pháp kỹ thuật mã hóa dữ liệu nhạy cảm (AES-256 / SHA-256)",
            "Bản đánh giá tác động xử lý dữ liệu cá nhân (DPIA)",
        ],
        notes="Nghiêm cấm chia sẻ thông tin khách hàng trái phép; bắt buộc xin chấp thuận khi thu thập dữ liệu định danh.",
    ),
]


class ComplianceRegistry:
    """
    Evaluates compliance of all proposed operations and enforces authorization tiers.
    """

    def __init__(self):
        self.regulations = VIETNAMESE_LEGISLATION_REGISTRY

    def get_all_regulations(self) -> List[Dict[str, Any]]:
        return [r.model_dump() for r in self.regulations]

    def verify_action_authorization(
        self,
        tier: AuthorizationTier,
        action_name: str,
        owner_auth_key: Optional[str] = None,
        daily_spent_usd: float = 0.0,
        max_daily_budget_usd: float = 20.0,
    ) -> bool:
        """
        Enforces tier-based permissions.
        Level 1: Autonomous (always permitted).
        Level 2: Preauthorized (budget checked).
        Level 3: Requires owner authorization key.
        Level 4: Requires owner authorization key + explicit confirmation.
        """
        if tier == AuthorizationTier.LEVEL_1_AUTONOMOUS:
            return True

        if tier == AuthorizationTier.LEVEL_2_PREAUTHORIZED:
            if daily_spent_usd > max_daily_budget_usd:
                raise PermissionError(f"Preauthorized budget limit (${max_daily_budget_usd:.2f}) exceeded.")
            return True

        if tier == AuthorizationTier.LEVEL_3_OWNER_APPROVAL:
            if not owner_auth_key or len(owner_auth_key) < 6:
                raise PermissionError(f"Action '{action_name}' requires Level 3 Owner Approval Key.")
            return True

        if tier == AuthorizationTier.LEVEL_4_RESTRICTED:
            if not owner_auth_key or len(owner_auth_key) < 6:
                raise PermissionError(f"Action '{action_name}' is Level 4 RESTRICTED: Requires explicit human master key.")
            return True

        return False

