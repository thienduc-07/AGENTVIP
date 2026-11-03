export interface AgentCandidate {
  id: string;
  type: string;
  name: string;
  role: string;
  department: string;
  floor: number;
  capabilities: string[];
  systemPromptSummary: string;
  matchedScore?: number;
}

export const KNOWN_AGENTS: AgentCandidate[] = [
  {
    id: "agent-exec-ceo",
    type: "orchestrator",
    name: "Victoria Vance",
    role: "Chief Executive Officer & Chief Orchestrator",
    department: "Executive",
    floor: 1,
    capabilities: [
      "strategic planning", "company governance", "multi-agent orchestration",
      "project breakdown", "executive delegation", "resource allocation", "board reporting"
    ],
    systemPromptSummary: "Directs company-wide operations, decomposes complex multi-stage objectives, and assigns subtasks across departments.",
  },
  {
    id: "agent-eng-lead",
    type: "reviewer",
    name: "David Chen",
    role: "Engineering Quality & Architecture Lead",
    department: "Engineering",
    floor: 2,
    capabilities: [
      "backend architecture", "api development", "code review", "system security",
      "database schema", "qa testing", "ci/cd pipeline", "performance tuning", "fastapi", "react"
    ],
    systemPromptSummary: "Reviews engineering artifacts, develops secure APIs, evaluates system resilience, and ensures code quality.",
  },
  {
    id: "agent-research-ai",
    type: "research",
    name: "Dr. Elena Rostova",
    role: "AI Research & Intelligence Specialist",
    department: "AI Research",
    floor: 3,
    capabilities: [
      "machine learning", "deep learning", "data mining", "academic research",
      "information retrieval", "document reading", "model evaluation", "llm prompting"
    ],
    systemPromptSummary: "Conducts deep technical research, queries knowledge graphs, analyzes source documents, and produces verified intelligence.",
  },
  {
    id: "agent-fin-controller",
    type: "analyst",
    name: "Julian Thorne",
    role: "Chief Financial Officer & Data Analyst",
    department: "Finance",
    floor: 5,
    capabilities: [
      "financial analysis", "budgeting", "data metrics", "cost guardrails",
      "revenue projections", "quantitative analysis", "accounting", "risk assessment"
    ],
    systemPromptSummary: "Performs mathematical analysis, inspects numerical telemetry, forecasts budgets, and monitors operational costs.",
  },
  {
    id: "agent-mkt-growth",
    type: "writer",
    name: "Sophia Martinez",
    role: "VP of Marketing, Brand & Content Strategy",
    department: "Marketing",
    floor: 4,
    capabilities: [
      "marketing campaign", "seo optimization", "content writing", "social media strategy",
      "brand design", "copywriting", "growth experiments", "press releases", "synthesis"
    ],
    systemPromptSummary: "Authors polished market reports, crafts engaging content copy, designs brand campaigns, and optimizes conversion funnels.",
  },
  {
    id: "agent-sales-director",
    type: "sales",
    name: "Marcus Reynolds",
    role: "Director of Enterprise Sales",
    department: "Sales",
    floor: 4,
    capabilities: [
      "enterprise sales", "client proposals", "customer meetings", "contract negotiation",
      "deal closing", "sales pipeline", "lead qualification"
    ],
    systemPromptSummary: "Manages B2B partnerships, generates client pitch decks, and leads high-value commercial enterprise engagements.",
  },
  {
    id: "agent-ops-recruiter",
    type: "operations",
    name: "Amara Okafor",
    role: "Head of People & Autonomous Operations",
    department: "Operations",
    floor: 5,
    capabilities: [
      "workforce allocation", "talent recruitment", "hr processes", "onboarding",
      "office logistics", "standard operating procedures", "policy compliance"
    ],
    systemPromptSummary: "Oversees workforce recruitment, manages talent onboarding, documents corporate procedures, and coordinates workplace operations.",
  },
  {
    id: "agent-support-lead",
    type: "support",
    name: "Liam O'Connor",
    role: "Head of Customer Success & Support",
    department: "Customer Success",
    floor: 1,
    capabilities: [
      "customer support", "ticket triage", "sla compliance", "troubleshooting",
      "incident response", "client satisfaction", "helpdesk workflows"
    ],
    systemPromptSummary: "Monitors customer health telemetry, troubleshoots user issues, and ensures rapid resolution of technical support tickets.",
  },
];

export interface RoutingResult {
  selectedAgent: AgentCandidate;
  isMultiAgentWorkflow: boolean;
  confidence: number;
  reasoning: string;
}

/**
 * Intelligent Agent Router
 * Analyzes natural language intent, scores candidate capabilities,
 * and routes to the best specialist or executive orchestrator.
 */
export function routeUserPrompt(
  prompt: string,
  preferredAgentId: string = "auto"
): RoutingResult {
  // If user explicitly selected an agent
  if (preferredAgentId && preferredAgentId !== "auto") {
    const candidate = KNOWN_AGENTS.find((a) => a.id === preferredAgentId);
    if (candidate) {
      return {
        selectedAgent: candidate,
        isMultiAgentWorkflow: candidate.id === "agent-exec-ceo",
        confidence: 1.0,
        reasoning: `Người dùng đã trực tiếp chỉ định chuyên viên ${candidate.name} (${candidate.role}).`,
      };
    }
  }

  const p = prompt.toLowerCase();

  // Multi-agent workflow detection
  const multiAgentKeywords = [
    "xây dựng hệ thống", "build a complete", "toàn diện", "end-to-end", "platform",
    "phát triển toàn bộ", "triển khai toàn diện", "e-commerce", "quy trình đầy đủ",
    "phối hợp", "tất cả phòng ban", "chiến lược công ty"
  ];
  const isMultiAgent = multiAgentKeywords.some((k) => p.includes(k));
  if (isMultiAgent) {
    const ceo = KNOWN_AGENTS.find((a) => a.id === "agent-exec-ceo")!;
    return {
      selectedAgent: ceo,
      isMultiAgentWorkflow: true,
      confidence: 0.95,
      reasoning: "Yêu cầu có tính phức tạp liên phòng ban; điều hướng đến CEO Victoria Vance để phân rã nhiệm vụ và điều phối đa chuyên viên.",
    };
  }

  // Capability scoring
  let bestAgent = KNOWN_AGENTS[1]; // default David Chen
  let highestScore = -1;
  let bestReason = "";

  for (const agent of KNOWN_AGENTS) {
    let score = 0;
    const matches: string[] = [];

    for (const cap of agent.capabilities) {
      const words = cap.split(" ");
      for (const w of words) {
        if (w.length > 2 && p.includes(w)) {
          score += 2;
          matches.push(w);
        }
      }
    }

    // Role and department matching
    if (p.includes(agent.department.toLowerCase())) score += 4;
    if (p.includes(agent.name.toLowerCase())) score += 8;

    // Specific domain keywords
    if (agent.id === "agent-eng-lead") {
      if (p.match(/code|api|backend|frontend|lỗi|bug|test|chạy|database|sql|server|endpoint|deploy/i)) score += 8;
    } else if (agent.id === "agent-fin-controller") {
      if (p.match(/tiền|chi phí|tài chính|giá cả|ngân sách|báo cáo số|cost|budget|doanh thu|finance|kế toán/i)) score += 12;
    } else if (agent.id === "agent-research-ai") {
      if (p.match(/nghiên cứu|research|tìm kiếm|search|đọc|tài liệu|paper|mô hình ai|llm/i)) score += 8;
    } else if (agent.id === "agent-mkt-growth") {
      if (p.match(/marketing|quảng bá|seo|bài viết|bài đăng|nội dung|content|landing page|thiết kế|brand/i)) score += 8;
    } else if (agent.id === "agent-sales-director") {
      if (p.match(/bán hàng|khách hàng|hợp đồng|đối tác|sales|chốt hợp đồng|proposal/i)) score += 8;
    } else if (agent.id === "agent-ops-recruiter") {
      if (p.match(/nhân sự|tuyển dụng|vận hành|onboard|quy trình|operations|hr/i)) score += 8;
    } else if (agent.id === "agent-support-lead") {
      if (p.match(/hỗ trợ|support|cskh|khiếu nại|ticket|khách phản ánh/i)) score += 8;
    }

    if (score > highestScore) {
      highestScore = score;
      bestAgent = agent;
      bestReason = matches.length > 0
        ? `Khớp năng lực chuyên môn: ${Array.from(new Set(matches)).join(", ")}`
        : `Phù hợp nhất với lĩnh vực chuyên môn của ${agent.role}`;
    }
  }

  const confidence = Math.min(0.98, Math.max(0.65, highestScore * 0.1));

  return {
    selectedAgent: bestAgent,
    isMultiAgentWorkflow: false,
    confidence,
    reasoning: bestReason || `Chuyên viên ${bestAgent.name} đảm nhiệm lĩnh vực này.`,
  };
}
