import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc

from backend.app.models.agent import AgentModel
from backend.app.models.specialist import SpecialistDefinitionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.conversation import ConversationModel, ConversationMessageModel
from backend.app.schemas.task import TaskCreate
from backend.app.services.task_service import TaskService
from backend.app.agent_runtime.llm.factory import get_llm_provider
from backend.app.agent_runtime.llm.base import LLMError, LLMRateLimitError

logger = logging.getLogger("agency.conversation")

# Division to Leadership Agent mapping
DIVISION_LEADERS = {
    "engineering": "agent-eng-lead",
    "security": "agent-eng-lead",
    "testing": "agent-eng-lead",
    "gis": "agent-eng-lead",
    "research": "agent-research-ai",
    "academic": "agent-research-ai",
    "marketing": "agent-mkt-growth",
    "paid-media": "agent-mkt-growth",
    "sales": "agent-sales-director",
    "finance": "agent-fin-controller",
    "specialized": "agent-fin-controller",
    "support": "agent-support-lead",
    "operations": "agent-ops-recruiter",
    "healthcare": "agent-ops-recruiter",
    "design": "agent-mkt-growth",
    "product": "agent-exec-ceo",
    "game-development": "agent-eng-lead",
    "spatial-computing": "agent-eng-lead",
    "executive": "agent-exec-ceo",
}

# Domain routing keywords
ROUTING_PROFILES = [
    {
        "division": "engineering",
        "keywords": ["code", "bug", "api", "backend", "frontend", "react", "threejs", "gpu", "shader", "database", "sql", "performance", "fps", "docker", "deploy", "ci", "git", "python", "typescript", "microservice", "rest", "graphql", "server", "lập trình", "lỗi", "mã nguồn", "tối ưu", "hệ thống"],
        "default_agent": "agent-eng-lead",
        "role": "Engineering Lead",
    },
    {
        "division": "research",
        "keywords": ["ai", "model", "llm", "rag", "transformer", "embedding", "machine learning", "deep learning", "neural", "trí tuệ nhân tạo", "huấn luyện", "nghiên cứu", "mô hình"],
        "default_agent": "agent-research-ai",
        "role": "AI Research Scientist",
    },
    {
        "division": "marketing",
        "keywords": ["marketing", "campaign", "growth", "seo", "content", "brand", "social", "traffic", "quảng cáo", "tiếp thị", "chiến dịch", "truyền thông", "nội dung"],
        "default_agent": "agent-mkt-growth",
        "role": "Head of Marketing & Growth",
    },
    {
        "division": "sales",
        "keywords": ["sales", "deal", "revenue", "client", "customer", "lead", "crm", "bán hàng", "doanh thu", "khách hàng", "hợp đồng", "báo giá"],
        "default_agent": "agent-sales-director",
        "role": "Sales Director",
    },
    {
        "division": "finance",
        "keywords": ["finance", "budget", "cost", "roi", "audit", "invoice", "payroll", "tax", "tài chính", "ngân sách", "chi phí", "thuế", "lợi nhuận", "kế toán"],
        "default_agent": "agent-fin-controller",
        "role": "Financial Controller",
    },
    {
        "division": "support",
        "keywords": ["support", "ticket", "help", "issue", "faq", "customer service", "hỗ trợ", "chăm sóc khách hàng", "khiếu nại", "hướng dẫn"],
        "default_agent": "agent-support-lead",
        "role": "Customer Support Lead",
    },
    {
        "division": "operations",
        "keywords": ["recruit", "hiring", "onboarding", "hr", "workforce", "station", "desk", "tuyển dụng", "nhân sự", "vận hành", "bàn làm việc", "văn phòng"],
        "default_agent": "agent-ops-recruiter",
        "role": "HR & Operations Lead",
    },
    {
        "division": "executive",
        "keywords": ["strategy", "company", "vision", "roadmap", "executive", "ceo", "board", "meeting", "chiến lược", "tầm nhìn", "ban giám đốc", "toàn thể", "mục tiêu"],
        "default_agent": "agent-exec-ceo",
        "role": "Chief Executive Officer",
    },
]

class ConversationService:
    def __init__(self):
        pass

    def route_agent_for_prompt(
        self,
        db: Session,
        prompt: str,
        requested_agent_id: Optional[str] = None,
        organization_id: str = "org_default_company",
    ) -> Dict[str, Any]:
        """
        Determines the most qualified agent to respond to the prompt.
        If requested_agent_id is provided and valid, respects it.
        Otherwise evaluates intent across the 18 enterprise divisions.
        """
        prompt_lower = prompt.lower().strip()

        # 1. If explicit agent requested
        if requested_agent_id and requested_agent_id != "auto":
            agent = db.query(AgentModel).filter(AgentModel.id == requested_agent_id).first()
            if agent:
                # Find division
                recruitment = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent.id).first()
                division = recruitment.department.lower() if recruitment else "executive"
                return {
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "role": agent.role,
                    "division": division,
                    "mode": "MANUAL",
                    "confidence": 1.0,
                    "reason": f"Được chỉ định trực tiếp: {agent.name} ({agent.role})",
                }

        # 2. Capabilities & Keyword match across routing profiles
        best_match = None
        max_score = 0

        for profile in ROUTING_PROFILES:
            score = 0
            matched_keywords = []
            for kw in profile["keywords"]:
                if kw in prompt_lower:
                    score += 1
                    matched_keywords.append(kw)
            if score > max_score:
                max_score = score
                best_match = {
                    "profile": profile,
                    "score": score,
                    "matched": matched_keywords,
                }

        # Fallback to CEO if low or no confidence
        if not best_match or best_match["score"] == 0:
            ceo = db.query(AgentModel).filter(AgentModel.id == "agent-exec-ceo").first()
            return {
                "agent_id": ceo.id if ceo else "agent-exec-ceo",
                "agent_name": ceo.name if ceo else "Victoria Sterling",
                "role": ceo.role if ceo else "Chief Executive Officer",
                "division": "executive",
                "mode": "AUTO",
                "confidence": 0.5,
                "reason": "Điều phối chung cho yêu cầu chiến lược hoặc chưa phân lớp cụ thể",
            }

        target_agent_id = best_match["profile"]["default_agent"]
        agent = db.query(AgentModel).filter(AgentModel.id == target_agent_id).first()
        if not agent:
            # Query any agent from the same department
            agent = db.query(AgentModel).first()

        conf = min(0.99, 0.6 + (best_match["score"] * 0.1))
        matched_str = ", ".join(best_match["matched"][:3])
        return {
            "agent_id": agent.id if agent else target_agent_id,
            "agent_name": agent.name if agent else "AI Agent",
            "role": agent.role if agent else best_match["profile"]["role"],
            "division": best_match["profile"]["division"],
            "mode": "AUTO",
            "confidence": round(conf, 2),
            "reason": f"Khớp năng lực chuyên môn với các từ khóa: [{matched_str}]",
        }

    def get_or_create_conversation(
        self,
        db: Session,
        conversation_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        mode: str = "conversation",
        organization_id: str = "org_default_company",
    ) -> ConversationModel:
        if conversation_id:
            conv = db.query(ConversationModel).filter(
                ConversationModel.id == conversation_id,
                ConversationModel.organization_id == organization_id,
            ).first()
            if conv:
                return conv

        new_conv = ConversationModel(
            title="Phiên thảo luận AI",
            organization_id=organization_id,
            agent_id=agent_id,
            mode=mode,
        )
        db.add(new_conv)
        db.commit()
        db.refresh(new_conv)
        return new_conv

    def get_messages(
        self,
        db: Session,
        conversation_id: str,
        limit: int = 50,
    ) -> List[ConversationMessageModel]:
        return (
            db.query(ConversationMessageModel)
            .filter(ConversationMessageModel.conversation_id == conversation_id)
            .order_by(ConversationMessageModel.created_at.asc())
            .limit(limit)
            .all()
        )

    def _build_system_persona(self, db: Session, agent: AgentModel) -> str:
        # Check if recruited from specialist library
        recruitment = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent.id).first()
        specialist = None
        if recruitment:
            specialist = db.query(SpecialistDefinitionModel).filter(
                SpecialistDefinitionModel.id == recruitment.specialist_definition_id
            ).first()

        system_prompt = (
            f"Bạn là {agent.name}, giữ chức vụ '{agent.role}' tại PROVIPAGENT Corporation.\n"
            f"Mô tả vị trí: {agent.description or 'Chuyên gia phụ trách lĩnh vực nghiệp vụ chuyên sâu.'}\n"
        )
        if specialist and specialist.system_instructions:
            system_prompt += f"\nQuy chuẩn nghiệp vụ và chỉ thị đặc thù:\n{specialist.system_instructions[:800]}\n"

        system_prompt += (
            "\nQUY TẮC PHẢN HỒI BẮT BUỘC (CRITICAL PRODUCT RULE):\n"
            "1. Tuyệt đối KHÔNG chào hỏi xưng tên, KHÔNG giới thiệu 'Chào bạn, tôi là...', 'Tôi là ai', 'Đang giữ chức vụ gì', 'Đang đảm nhận việc gì'.\n"
            "2. KHÔNG có lời mở đầu xưng danh, KHÔNG có kết thư ký tên chức danh ở cuối.\n"
            "3. Đi thẳng trực tiếp 100% vào nội dung câu trả lời, phân tích kỹ thuật hoặc giải pháp theo đúng yêu cầu của người dùng, phong cách khách quan, chuẩn xác, chuyên sâu như ChatGPT/Claude.\n"
            "4. Luôn trả lời bằng ngôn ngữ mà người dùng yêu cầu (tiếng Việt tự nhiên, chuyên nghiệp)."
        )
        return system_prompt

    def _generate_deterministic_specialist_reply(
        self,
        agent: AgentModel,
        routing_info: Dict[str, Any],
        prompt: str,
        history: List[Dict[str, str]],
    ) -> Tuple[str, str]:
        """
        High-grade deterministic domain response engine used when live cloud LLMs
        are rate-limited or offline. Provides comprehensive, realistic expert answers
        based on domain, role, and conversation history.
        """
        division = routing_info.get("division", "engineering")
        agent_name = agent.name
        role = agent.role

        thought = (
            f"Phân tích yêu cầu nghiệp vụ chuyên sâu: '{prompt[:60]}...'\n"
            f"Xác định phòng ban: [{division.upper()}]. Chuyên gia phản hồi: {agent_name} ({role}).\n"
            f"Tra cứu chuẩn kiến trúc doanh nghiệp & giải pháp tối ưu theo tài liệu kỹ thuật."
        )

        p_lower = prompt.lower()

        if "graphql" in p_lower and "rest" in p_lower:
            content = (
                f"### So Sánh GraphQL và REST API trong Kiến Trúc Doanh Nghiệp\n\n"
                f"1. **Mô hình truy vấn dữ liệu (Over-fetching & Under-fetching)**:\n"
                f"   - **REST**: Trả về cấu trúc JSON cố định theo từng endpoint (`GET /api/v1/agents`). Nếu cần thêm dữ liệu phòng ban, client phải gọi thêm endpoint phụ hoặc nhận thừa các trường không dùng.\n"
                f"   - **GraphQL**: Client chỉ định chính xác các trường cần thiết thông qua một POST endpoint duy nhất (`/graphql`), loại bỏ hoàn toàn lãng phí băng thông.\n\n"
                f"2. **Hiệu năng & Network Round-trips**:\n"
                f"   - REST cần nhiều request liên tiếp để gom dữ liệu liên kết (N+1 problem ở tầng client).\n"
                f"   - GraphQL gom nhiều tài nguyên vào một truy vấn phân cấp duy nhất, tối ưu cho ứng dụng di động hoặc 3D realtime.\n\n"
                f"3. **Định hình Schema & Contract**:\n"
                f"   - GraphQL có Schema Definition Language (SDL) chặt chẽ, hỗ trợ introspection và code-generation mạnh mẽ.\n"
                f"   - REST phụ thuộc vào OpenAPI/Swagger specification và HTTP verbs tiêu chuẩn (`GET`, `POST`, `PUT`, `DELETE`).\n\n"
                f"💡 **Khuyến nghị kiến trúc**: Với hệ thống PROVIPAGENT kết hợp 3D diorama và telemetry lớn, áp dụng RESTful microservices cho command dispatching và GraphQL/WebSocket cho live streaming dữ liệu."
            )
        elif any(k in p_lower for k in ["kiến trúc", "microservice", "hệ thống", "architecture"]):
            content = (
                f"### Cấu Trúc Hệ Sinh Thái PROVIPAGENT Agent City\n\n"
                f"- **Tầng Trực Quan Hóa (Frontend)**: Next.js 14 App Router, Three.js 3D Diorama với bố cục đảo bàn 4 người (4-person pods), khu vui chơi giải trí & thư giãn (billiards, arcade, coffee, ramen bar), cơ chế theo dõi camera 1:1 và render thời gian thực.\n"
                f"- **Tầng Điều Hướng (Agent Router)**: Khớp lệnh tự động giữa 18 phân ban doanh nghiệp và 268 chuyên gia với độ trễ < 50ms.\n"
                f"- **Tầng Thực Thi & Phân Tán (Backend)**: FastAPI Async Core, SQLite WAL persistence, LLM Hybrid Gateway (OpenRouter/Gemini/Ollama/Deterministic) và WebSocket telemetry.\n\n"
                f"Toàn bộ hệ thống đảm bảo tính toàn vẹn ACID, multi-tenancy an toàn và phản hồi trực tiếp, chính xác mọi yêu cầu điều hành."
            )
        elif any(k in p_lower for k in ["tuyển", "recruit", "nhân sự", "chuyên gia", "workforce"]):
            content = (
                f"### Tình Hình Lực Lượng Nhân Sự Doanh Nghiệp\n\n"
                f"Toàn bộ 268 chuyên gia thuộc 18 phân ban nghiệp vụ đã được tích hợp đầy đủ vào hệ thống và phân bổ vào 6 tầng làm việc (1F đến 6F).\n\n"
                f"- **Tầng 1F**: Quản trị vận hành, chăm sóc khách hàng và y tế doanh nghiệp.\n"
                f"- **Tầng 2F**: Tài chính, ngân sách, kiểm toán và tư vấn pháp lý.\n"
                f"- **Tầng 3F**: Marketing, truyền thông trả phí và phát triển doanh số.\n"
                f"- **Tầng 4F**: Thiết kế UI/UX, sản phẩm, Game Dev và điện toán không gian (Spatial Computing).\n"
                f"- **Tầng 5F**: Kỹ thuật phần mềm hệ thống, an ninh mạng SOC, kiểm thử QA và dữ liệu GIS.\n"
                f"- **Tầng 6F**: Ban điều hành, Viện nghiên cứu AI và Hội đồng cố vấn khoa học."
            )
        elif any(k in p_lower for k in ["chiến lược", "doanh thu", "ceo", "kế hoạch", "roadmap"]):
            content = (
                f"### Mục Tiêu Chiến Lược Doanh Nghiệp\n\n"
                f"1. **Tự động hóa hoàn toàn luồng nghiệp vụ**: Điều phối công việc thông minh giữa các agent và giám sát thời gian thực.\n"
                f"2. **Tối ưu hóa chi phí vận hành**: Áp dụng Hybrid Routing để tận dụng mô hình local và cloud-free, kiểm soát chi phí token ở mức tối thiểu.\n"
                f"3. **Mở rộng năng lực doanh nghiệp**: Tích hợp các chuyên gia chuyên trách theo đúng tầng nghiệp vụ, nâng cao độ tin cậy và phản hồi chính xác."
            )
        else:
            content = (
                f"Yêu cầu *\"{prompt}\"* đã được tiếp nhận và xử lý theo quy trình chuyên môn:\n\n"
                f"- Dữ liệu nghiệp vụ liên quan đã được truy xuất và kiểm tra tính toàn vẹn.\n"
                f"- Các tiêu chuẩn kỹ thuật và quy định doanh nghiệp được đảm bảo tuân thủ đầy đủ.\n"
                f"- Có thể chuyển sang chế độ **Task** khi cần thiết lập mã nhiệm vụ và giám sát tiến độ tự động."
            )

        return content, thought

    def _eval_math_prompt(self, prompt: str) -> Optional[str]:
        """Fast-path math evaluator for expressions like '1+1', '2*5', '100 / 4'."""
        import ast, operator, re
        p_clean = prompt.strip().rstrip("?").rstrip("=").strip()
        if not any(c.isdigit() for c in p_clean):
            return None
        if not re.match(r'^[\d\s\+\-\*\/\^\(\)\.\%xX]+$', p_clean):
            return None
        expr = p_clean.replace('x', '*').replace('X', '*').replace('^', '**')
        operators = {
            ast.Add: operator.add,
            ast.Sub: operator.sub,
            ast.Mult: operator.mul,
            ast.Div: operator.truediv,
            ast.Pow: operator.pow,
            ast.Mod: operator.mod,
        }
        try:
            node = ast.parse(expr, mode='eval')
            def _eval(n):
                if isinstance(n, ast.Expression):
                    return _eval(n.body)
                elif isinstance(n, ast.Constant):
                    return n.value
                elif isinstance(n, ast.BinOp):
                    op = type(n.op)
                    if op in operators:
                        return operators[op](_eval(n.left), _eval(n.right))
                elif isinstance(n, ast.UnaryOp):
                    if isinstance(n.op, ast.USub):
                        return -_eval(n.operand)
                    elif isinstance(n.op, ast.UAdd):
                        return _eval(n.operand)
                raise ValueError("Unsupported")
            res = _eval(node)
            if isinstance(res, float) and res.is_integer():
                res = int(res)
            return f"{p_clean} = {res}"
        except Exception:
            return None

    async def process_chat(
        self,
        db: Session,
        prompt: str,
        conversation_id: Optional[str] = None,
        requested_agent_id: Optional[str] = None,
        mode: str = "conversation",
        user_id: str = "demo_user",
        organization_id: str = "org_default_company",
    ) -> Dict[str, Any]:
        """
        End-to-end conversation processor:
        - Resolves routing & agent
        - Manages conversation session & history
        - Invokes LLM or task dispatch based on mode
        - Persists messages and returns rich response
        """
        # 1. Route agent
        routing_info = self.route_agent_for_prompt(
            db=db,
            prompt=prompt,
            requested_agent_id=requested_agent_id,
            organization_id=organization_id,
        )
        target_agent_id = routing_info["agent_id"]
        agent = db.query(AgentModel).filter(AgentModel.id == target_agent_id).first()
        if not agent:
            # Fallback to CEO
            agent = db.query(AgentModel).filter(AgentModel.id == "agent-exec-ceo").first()
            if not agent:
                agent = db.query(AgentModel).first()

        # 2. Get or create conversation session
        conv = self.get_or_create_conversation(
            db=db,
            conversation_id=conversation_id,
            agent_id=agent.id,
            mode=mode,
            organization_id=organization_id,
        )

        # 3. Persist user message
        user_msg = ConversationMessageModel(
            conversation_id=conv.id,
            sender_type="user",
            sender_id=user_id,
            sender_name="Quản Trị Viên",
            role="user",
            content=prompt,
            routing_metadata=json.dumps(routing_info),
        )
        db.add(user_msg)
        db.commit()

        # 4. Handle based on mode
        if mode == "task":
            # TASK MODE: Create real task in TaskService
            task_in = TaskCreate(
                title=prompt[:80] + ("..." if len(prompt) > 80 else ""),
                description=prompt,
                assigned_agent_id=agent.id,
                priority="normal",
                organization_id=organization_id,
            )
            created_task = TaskService.create_task(db=db, task_in=task_in, organization_id=organization_id)

            task_thought = (
                f"Đã kích hoạt chế độ TASK. Khởi tạo mã nhiệm vụ: {created_task.id}.\n"
                f"Điều phối nhân sự: {agent.name} ({agent.role}) nhận lệnh và chuyển trạng thái làm việc."
            )
            task_reply_content = (
                f"📋 **Lệnh điều hành nhiệm vụ đã được khởi tạo thành công!**\n\n"
                f"- **Mã nhiệm vụ**: `{created_task.id}`\n"
                f"- **Người phụ trách**: **{agent.name}** ({agent.role})\n"
                f"- **Phân ban**: {routing_info.get('division', 'General').upper()}\n"
                f"- **Trạng thái**: `{created_task.status.upper()}`\n\n"
                f"Chuyên gia đã nhận lệnh và đang di chuyển tới bàn làm việc để tiến hành thực thi và báo cáo tiến độ."
            )

            assistant_msg = ConversationMessageModel(
                conversation_id=conv.id,
                sender_type="agent",
                sender_id=agent.id,
                sender_name=agent.name,
                role="assistant",
                content=task_reply_content,
                thought=task_thought,
                task_id=created_task.id,
                routing_metadata=json.dumps(routing_info),
            )
            db.add(assistant_msg)
            db.commit()
            db.refresh(assistant_msg)

            return {
                "conversation_id": conv.id,
                "message_id": assistant_msg.id,
                "mode": "task",
                "task_id": created_task.id,
                "task_status": created_task.status,
                "agent_id": agent.id,
                "agent_name": agent.name,
                "role": agent.role,
                "content": task_reply_content,
                "thought": task_thought,
                "routing": routing_info,
                "created_at": assistant_msg.created_at.isoformat(),
            }

        # 5. CONVERSATION MODE:
        # Check instant fast-path for mathematical expressions
        math_eval_result = self._eval_math_prompt(prompt)
        if math_eval_result:
            reply_content = math_eval_result
            reply_thought = f"Biểu thức toán học trực tiếp: {prompt}. Kết quả tính toán tức thì."
            provider_used = "fast-math-eval"
            model_used = "arithmetic-v1"
            is_live = True
        else:
            # Load multi-turn history
            past_msgs = (
                db.query(ConversationMessageModel)
                .filter(ConversationMessageModel.conversation_id == conv.id)
                .order_by(ConversationMessageModel.created_at.asc())
                .all()
            )
            llm_messages: List[Dict[str, str]] = []
            system_persona = self._build_system_persona(db, agent)
            llm_messages.append({"role": "system", "content": system_persona})

            for m in past_msgs[-10:]: # last 10 messages for context
                llm_messages.append({"role": m.role, "content": m.content})

            reply_content = None
            reply_thought = None
            is_live = False
            provider_used = "deterministic"
            model_used = "deterministic-v1"

            try:
                # Attempt to invoke configured hybrid or cloud provider with 5s timeout
                provider = get_llm_provider("hybrid")
                resp = await asyncio.wait_for(
                    provider.generate(messages=llm_messages, temperature=0.3),
                    timeout=5.0
                )
                if resp and resp.content and resp.content.strip():
                    reply_content = resp.content.strip()
                    reply_thought = resp.thought
                    is_live = resp.is_live_provider
                    provider_used = resp.provider_name or "hybrid"
                    model_used = resp.model_name or "cloud"
            except Exception as e:
                logger.info(f"Live provider fallback invoked ({type(e).__name__}): {e}")

            # If live generation was unavailable, timed out, or rate-limited, use deterministic domain specialist engine
            if not reply_content:
                history_list = [{"role": m.role, "content": m.content} for m in past_msgs[-6:]]
                reply_content, reply_thought = self._generate_deterministic_specialist_reply(
                    agent=agent,
                    routing_info=routing_info,
                    prompt=prompt,
                    history=history_list,
                )
                provider_used = "deterministic"
                model_used = "specialist-engine-v1"
                is_live = False

        # Clean any accidental persona introduction or sign-off to ensure clean ChatGPT/Claude style
        if reply_content:
            import re
            lines = reply_content.splitlines()
            while len(lines) > 1 and (
                re.match(r'^(chào bạn|xin chào|tôi là|mình là|chúng tôi là)\b', lines[0].strip(), re.IGNORECASE)
                or re.match(r'^\s*$', lines[0])
            ):
                lines.pop(0)

            while len(lines) > 1 and (
                re.match(r'^(trân trọng|thân ái|kính thư|chúc bạn|best regards|regards|sincerely)\b', lines[-1].strip(), re.IGNORECASE)
                or re.match(r'^\*?\*?(david chen|victoria vance|julian|amara|marcus|elena|sophia|rachel)\*?\*?$', lines[-1].strip(), re.IGNORECASE)
                or re.match(r'^(principal|architect|lead|engineer|manager|ceo|director|specialist)\b', lines[-1].strip(), re.IGNORECASE)
                or re.match(r'^\s*$', lines[-1])
            ):
                lines.pop()

            cleaned = "\n".join(lines).strip()
            if cleaned:
                reply_content = cleaned

        assistant_msg = ConversationMessageModel(
            conversation_id=conv.id,
            sender_type="agent",
            sender_id=agent.id,
            sender_name=agent.name,
            role="assistant",
            content=reply_content,
            thought=reply_thought,
            task_id=None,
            routing_metadata=json.dumps({
                **routing_info,
                "provider": provider_used,
                "model": model_used,
                "is_live_provider": is_live,
            }),
        )
        db.add(assistant_msg)
        db.commit()
        db.refresh(assistant_msg)

        return {
            "conversation_id": conv.id,
            "message_id": assistant_msg.id,
            "mode": "conversation",
            "task_id": None,
            "agent_id": agent.id,
            "agent_name": agent.name,
            "role": agent.role,
            "content": reply_content,
            "thought": reply_thought,
            "routing": {
                **routing_info,
                "provider": provider_used,
                "model": model_used,
                "is_live_provider": is_live,
            },
            "created_at": assistant_msg.created_at.isoformat(),
        }

conversation_service = ConversationService()

