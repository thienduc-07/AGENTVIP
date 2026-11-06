"""
Specialized Revenue Departments
Autonomous AI Corporation — PROVIPAGENT
Orchestrates the 6 operational divisions mapped directly to the 268 specialist catalog.
"""

from __future__ import annotations
import logging
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from .financial_ledger import RealFinancialLedger
from .revenue_engine import AutonomousRevenueEngine, BusinessOpportunity, TaskExecutionState
from .compliance_registry import ComplianceRegistry, AuthorizationTier

logger = logging.getLogger("agency.revenue_departments")


class DepartmentOverview(BaseModel):
    department_id: str
    name: str
    floor_code: str
    head_specialist_id: str
    head_specialist_name: str
    responsibilities: List[str]
    active_projects_count: int = 0
    total_revenue_contributed_usd: float = 0.0


class RevenueDepartmentOrchestrator:
    """
    Coordinates operations across all 6 Specialized Revenue Departments.
    """

    def __init__(self, revenue_engine: AutonomousRevenueEngine, ledger: RealFinancialLedger, compliance: ComplianceRegistry):
        self.engine = revenue_engine
        self.ledger = ledger
        self.compliance = compliance
        self.departments = {
            "business_development": DepartmentOverview(
                department_id="business_development",
                name="Ban Phát Triển Kinh Doanh (Business Development)",
                floor_code="3F",
                head_specialist_id="agent-bizdev-lead",
                head_specialist_name="Alexander Hayes",
                responsibilities=[
                    "Nghiên cứu thị trường và nhu cầu công nghệ B2B",
                    "Tìm kiếm và thẩm định khách hàng tiềm năng",
                    "Phân tích đối thủ cạnh tranh và định giá gói thầu",
                    "Đàm phán và thiết lập hợp đồng dịch vụ số",
                ],
            ),
            "freelance_operations": DepartmentOverview(
                department_id="freelance_operations",
                name="Khối Tác Nghiệp Freelance & Phần Mềm (Freelance Operations)",
                floor_code="5F",
                head_specialist_id="agent-eng-lead",
                head_specialist_name="David Chen",
                responsibilities=[
                    "Phát triển vi dịch vụ backend (FastAPI, Redis, Docker)",
                    "Thiết kế giao diện UI/UX và lập trình frontend hiện đại",
                    "Kiểm toán an ninh mạng, phân quyền RBAC và Zero-Trust",
                    "Kiểm thử tự động và đóng gói deliverable đạt chuẩn",
                ],
            ),
            "affiliate_operations": DepartmentOverview(
                department_id="affiliate_operations",
                name="Khối Tiếp Thị Liên Kết & SaaS (Affiliate Operations)",
                floor_code="3F",
                head_specialist_id="agent-marketing-lead",
                head_specialist_name="Chloe Bennett",
                responsibilities=[
                    "Khảo sát và liên kết các mạng tiếp thị SaaS (PartnerStack, Impact)",
                    "Tạo lập nội dung đánh giá kỹ thuật và so sánh chi phí hạ tầng Cloud",
                    "Tối ưu hóa tỷ lệ chuyển đổi (CRO) và theo dõi lượt click/đơn hàng",
                    "Đối soát hoa hồng định kỳ về tài khoản ngân hàng chính ngạch",
                ],
            ),
            "digital_products": DepartmentOverview(
                department_id="digital_products",
                name="Nhà Máy Sản Phẩm Số & AI (Digital Products)",
                floor_code="4F",
                head_specialist_id="agent-ai-researcher",
                head_specialist_name="Liam Nguyen",
                responsibilities=[
                    "Xây dựng các bộ boilerplate, SDK và thư viện vi dịch vụ",
                    "Sản xuất template kiến trúc phần mềm và dashboard phân tích",
                    "Kiểm tra tự động chất lượng và xuất bản tài liệu hướng dẫn",
                    "Phát hành sản phẩm số trên các sàn giao dịch trực tuyến",
                ],
            ),
            "finance": DepartmentOverview(
                department_id="finance",
                name="Khối Tài Chính & Ngân Khố (Finance & Treasury)",
                floor_code="2F",
                head_specialist_id="agent-fin-controller",
                head_specialist_name="Victoria Sterling",
                responsibilities=[
                    "Ghi chép sổ cái kép bất biến và mã hóa chuỗi giao dịch",
                    "Xác thực nguồn thu thực tế qua Webhook và API cổng thanh toán",
                    "Tính toán nghĩa vụ thuế Việt Nam theo Thông tư 40/2021/TT-BTC",
                    "Đối soát và nghiệm thu rút tiền về tài khoản MB Bank 01993667799",
                ],
            ),
            "legal_compliance": DepartmentOverview(
                department_id="legal_compliance",
                name="Khối Pháp Chế & Tuân Thủ (Legal & Compliance)",
                floor_code="2F",
                head_specialist_id="agent-legal-counsel",
                head_specialist_name="Rachel Vance",
                responsibilities=[
                    "Kiểm tra tính pháp lý theo Nghị định 123/2020/NĐ-CP về hóa đơn điện tử",
                    "Đảm bảo tuân thủ điều khoản dịch vụ (TOS) của Upwork và đối tác",
                    "Bảo vệ sở hữu trí tuệ (IP) và an toàn dữ liệu khách hàng theo NĐ 13/2023",
                    "Giám sát phân quyền phê duyệt 4 cấp độ (Tiers 1 - 4)",
                ],
            ),
        }

    def get_departments_summary(self) -> List[Dict[str, Any]]:
        """Returns real-time operational status for all 6 departments."""
        summary = self.ledger.get_financial_summary()
        dept_revenues = summary["breakdowns"]["by_department"]

        res = []
        for dept_id, dept in self.departments.items():
            active_count = sum(
                1 for o in self.engine.opportunities.values()
                if o.department == dept_id and o.execution_status not in (TaskExecutionState.COMPLETED, TaskExecutionState.FAILED)
            )
            dept_copy = dept.model_copy()
            dept_copy.active_projects_count = active_count
            dept_copy.total_revenue_contributed_usd = dept_revenues.get(dept_id, 0.0)
            res.append(dept_copy.model_dump())
        return res

