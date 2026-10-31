import { create } from "zustand";
import { AgentCharacterData, IslandArea, WorldAgentStatus, Agent } from "@/types";
import { DEMO_AGENTS } from "@/data/demoAgents";
import { ISLAND_AREAS } from "@/data/areaConfig";
import { WORLD_CONFIG } from "@/data/worldConfig";
import { EventEnvelope, WsSnapshotData, ApiTask, Workflow, Subtask } from "@/types/api";

export interface TaskHandoffAnimation {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  skillName: string;
  taskTitle: string;
  startTime: number;
  duration: number;
}

export interface QueueStep {
  id: string;
  agentId: string;
  agentName: string;
  stepTitle: string;
  skillName: string;
  vietnameseSkill: string;
  status: "pending" | "moving" | "firing" | "completed";
  outputSummary?: string;
}

export interface DeliverableArtifact {
  id: string;
  type: "docx" | "xlsx" | "pptx" | "pdf" | "web" | "code" | "media";
  title: string;
  filename: string;
  description: string;
  content?: string;
  mimeType?: string;
  previewHtml?: string;
  size?: string;
  downloadDataUrl?: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "ceo" | "agent" | "system";
  agentId?: string;
  agentName?: string;
  text: string;
  timestamp: number;
  queue?: QueueStep[];
  artifact?: DeliverableArtifact;
}

export interface MovingAgentState {
  agentId: string;
  fromPos: [number, number, number];
  targetPos: [number, number, number];
  progress: number;
}

interface WorldState {
  // Entities
  agents: Record<string, AgentCharacterData>;
  areas: Record<string, IslandArea>;

  // Selection & Hover
  selectedAgentId: string | null;
  selectedAreaId: string | null;
  hoveredAgentId: string | null;
  hoveredAreaId: string | null;

  // Realtime Sequence & Streaming
  lastSequenceId: number;
  processedEventIds: string[];
  activeTasks: Record<string, ApiTask>;
  recentEvents: EventEnvelope[];
  activeWorkflow: Workflow | null;

  // Task Handoff Anime Skill VFX
  activeHandoff: TaskHandoffAnimation | null;

  // Mission Terminal & Interactive Chat
  isMissionTerminalOpen: boolean;
  isExecutingMission: boolean;
  chatMessages: ChatMessage[];
  executionQueue: QueueStep[];
  activeDeliverables: DeliverableArtifact[];
  movingAgent: MovingAgentState | null;

  // Memory Center Modal
  isMemoryCenterOpen: boolean;
  memoryRefreshTrigger: number;

  // Tool Center Modal (Milestone 8)
  isToolCenterOpen: boolean;
  toolRefreshTrigger: number;

  // Specialist Recruitment Hub (Module 2)
  isSpecialistRecruitmentOpen: boolean;

  // Camera Control
  cameraPreset: "tactical" | "agent" | "area";
  cameraTarget: [number, number, number];
  cameraPosition: [number, number, number];

  // UI Panels
  activeInfoPanel: "agent" | "area" | "none";
  controlsHelpVisible: boolean;
  isLiveConnected: boolean;
  backendConnection: "connected" | "connecting" | "reconnecting" | "error" | "demo_fallback";
  backendError: string | null;

  // Actions
  selectAgent: (agentId: string | null) => void;
  selectArea: (areaId: string | null) => void;
  resetToTacticalOverview: () => void;
  smoothFocusCamera: (camPos: [number, number, number], targetPos: [number, number, number], areaId?: string) => void;
  setHoveredAgent: (agentId: string | null) => void;
  setHoveredArea: (areaId: string | null) => void;
  toggleControlsHelp: () => void;
  setControlsHelpVisible: (visible: boolean) => void;
  closeInfoPanel: () => void;
  setIsMissionTerminalOpen: (open: boolean) => void;
  setMovingAgent: (moving: MovingAgentState | null) => void;
  setIsMemoryCenterOpen: (open: boolean) => void;
  triggerMemoryRefresh: () => void;
  setIsToolCenterOpen: (open: boolean) => void;
  triggerToolRefresh: () => void;
  setIsSpecialistRecruitmentOpen: (open: boolean) => void;
  setLiveConnected: (connected: boolean) => void;
  setBackendStatus: (
    status: "connected" | "connecting" | "reconnecting" | "error" | "demo_fallback",
    error?: string | null
  ) => void;
  updateAgentStatus: (agentId: string, status: WorldAgentStatus, currentTask?: string | null) => void;
  syncAgentsFromBackend: (backendAgents: (Agent | any)[]) => void;
  applySnapshot: (snapshotData: WsSnapshotData, lastSeq: number) => void;
  applyEvent: (envelope: EventEnvelope) => void;
  setActiveWorkflow: (wf: Workflow | null) => void;
  triggerTaskHandoff: (fromAgentId: string, toAgentId: string, skillName?: string, taskTitle?: string) => void;
  clearTaskHandoff: () => void;
  executeMissionPipeline: (userPrompt: string) => Promise<void>;
  agentActivities: Record<string, string>;
  setAgentActivity: (agentId: string, activity: string) => void;
}

const initialAgentsMap = DEMO_AGENTS.reduce<Record<string, AgentCharacterData>>((acc, agent) => {
  acc[agent.id] = agent;
  return acc;
}, {});

export const useWorldStore = create<WorldState>((set, get) => ({
  agents: initialAgentsMap,
  areas: ISLAND_AREAS,

  selectedAgentId: null,
  selectedAreaId: null,
  hoveredAgentId: null,
  hoveredAreaId: null,

  lastSequenceId: 0,
  processedEventIds: [],
  activeTasks: {},
  recentEvents: [],
  activeWorkflow: null,
  activeHandoff: null,

  isMissionTerminalOpen: false,
  isExecutingMission: false,
  chatMessages: [
    {
      id: "msg_welcome",
      sender: "ceo",
      agentName: "Victoria Vance (CEO)",
      text: "Chào mừng quý khách đến với AI Agency — Autonomous Business Headquarters! Tôi là Victoria Vance, Giám đốc điều hành. Toàn bộ 8 phòng ban tự trị (Điều hành, Kỹ thuật, Nghiên cứu AI, Marketing, Kinh doanh B2B, Tài chính, Vận hành & Tuyển dụng, Chăm sóc khách hàng) đã sẵn sàng kết nối runtime thực thi nhiệm vụ doanh nghiệp thực tế. Vui lòng giao nhiệm vụ để bắt đầu!",
      timestamp: Date.now(),
    },
  ],
  executionQueue: [],
  activeDeliverables: [],
  movingAgent: null,

  agentActivities: {
    "agent-exec-ceo": "strategy_review",
    "agent-eng-lead": "code_architecture",
    "agent-research-ai": "neural_indexing",
    "agent-mkt-growth": "campaign_optimization",
    "agent-sales-director": "pipeline_review",
    "agent-fin-controller": "ledger_audit",
    "agent-ops-recruiter": "talent_onboarding",
    "agent-support-lead": "sla_monitoring",
  },
  setAgentActivity: (agentId: string, activity: string) =>
    set((state) => ({
      agentActivities: {
        ...state.agentActivities,
        [agentId]: activity,
      },
    })),

  isMemoryCenterOpen: false,
  memoryRefreshTrigger: 0,

  isToolCenterOpen: false,
  toolRefreshTrigger: 0,

  isSpecialistRecruitmentOpen: false,

  cameraPreset: "tactical",
  cameraTarget: WORLD_CONFIG.tacticalCamera.target,
  cameraPosition: WORLD_CONFIG.tacticalCamera.position,

  activeInfoPanel: "none",
  controlsHelpVisible: true,
  isLiveConnected: false,
  backendConnection: "connecting",
  backendError: null,

  setIsMissionTerminalOpen: (open: boolean) => set({ isMissionTerminalOpen: open }),
  setMovingAgent: (moving) => set({ movingAgent: moving }),

  selectAgent: (agentId: string | null) => {
    if (!agentId) {
      set({
        selectedAgentId: null,
        activeInfoPanel: get().activeInfoPanel === "agent" ? "none" : get().activeInfoPanel,
      });
      return;
    }

    const agent = get().agents[agentId];
    if (!agent) return;

    set({
      selectedAgentId: agentId,
      selectedAreaId: null,
      activeInfoPanel: "agent",
      cameraPreset: "agent",
      cameraTarget: [agent.position[0], agent.position[1] + 1.0, agent.position[2]],
      cameraPosition: [agent.position[0] + 5.2, agent.position[1] + 3.4, agent.position[2] + 6.2],
    });
  },

  selectArea: (areaId: string | null) => {
    if (!areaId) {
      set({
        selectedAreaId: null,
        activeInfoPanel: get().activeInfoPanel === "area" ? "none" : get().activeInfoPanel,
      });
      return;
    }

    const area = get().areas[areaId];
    if (!area) return;

    set({
      selectedAreaId: areaId,
      selectedAgentId: null,
      activeInfoPanel: "area",
      cameraPreset: "area",
      cameraTarget: area.cameraTarget,
      cameraPosition: area.cameraPosition,
    });
  },

  resetToTacticalOverview: () => {
    set({
      selectedAgentId: null,
      selectedAreaId: null,
      activeInfoPanel: "none",
      cameraPreset: "tactical",
      cameraTarget: WORLD_CONFIG.tacticalCamera.target,
      cameraPosition: WORLD_CONFIG.tacticalCamera.position,
    });
  },

  smoothFocusCamera: (camPos, targetPos, areaId) => {
    set({
      selectedAreaId: areaId ?? null,
      selectedAgentId: null,
      cameraPreset: "area",
      cameraPosition: camPos,
      cameraTarget: targetPos,
    });
  },

  setHoveredAgent: (agentId) => set({ hoveredAgentId: agentId }),
  setHoveredArea: (areaId) => set({ hoveredAreaId: areaId }),

  toggleControlsHelp: () => set((state) => ({ controlsHelpVisible: !state.controlsHelpVisible })),
  setControlsHelpVisible: (visible) => set({ controlsHelpVisible: visible }),

  closeInfoPanel: () => set({ activeInfoPanel: "none", selectedAgentId: null, selectedAreaId: null }),

  setLiveConnected: (connected) => set({ isLiveConnected: connected }),

  setBackendStatus: (status, error = null) => set({ backendConnection: status, backendError: error }),

  updateAgentStatus: (agentId, status, currentTask) => {
    set((state) => {
      const existing = state.agents[agentId];
      if (!existing) return state;

      return {
        agents: {
          ...state.agents,
          [agentId]: {
            ...existing,
            status,
            currentTask: currentTask !== undefined ? currentTask : existing.currentTask,
          },
        },
      };
    });
  },

  syncAgentsFromBackend: (backendAgents) => {
    set((state) => {
      const updated = { ...state.agents };

      backendAgents.forEach((ba: any) => {
        let mappedStatus: WorldAgentStatus = "idle";
        const rawStatus = (ba.status || "").toLowerCase();
        if (rawStatus === "working" || rawStatus === "thinking" || rawStatus === "executing_tool") {
          mappedStatus = "working";
        } else if (rawStatus === "waiting_approval" || rawStatus === "awaiting_approval") {
          mappedStatus = "waiting_approval";
        } else if (rawStatus === "error" || rawStatus === "failed") {
          mappedStatus = "error";
        } else if (rawStatus === "offline") {
          mappedStatus = "offline";
        } else {
          mappedStatus = "idle";
        }

        const posX = ba.pos_x ?? (updated[ba.id]?.position?.[0] || 0);
        const posY = ba.pos_y ?? (updated[ba.id]?.position?.[1] || 1);
        const posZ = ba.pos_z ?? (updated[ba.id]?.position?.[2] || 0);

        if (updated[ba.id]) {
          updated[ba.id] = {
            ...updated[ba.id],
            name: ba.name,
            role: ba.role,
            status: mappedStatus,
            color: ba.color || updated[ba.id].color,
            description: ba.description || updated[ba.id].description,
            isDemo: false,
          };
        } else {
          updated[ba.id] = {
            id: ba.id,
            name: ba.name,
            role: ba.role,
            station: ba.station || "harbor",
            position: [posX, posY, posZ],
            status: mappedStatus,
            appearance: ba.avatar || "captain",
            color: ba.color || "#f59e0b",
            description: ba.description,
            isDemo: false,
          };
        }
      });

      return { agents: updated, backendConnection: "connected", backendError: null };
    });
  },

  applySnapshot: (snapshotData: WsSnapshotData, lastSeq: number) => {
    get().syncAgentsFromBackend(snapshotData.agents);
    const activeTasksMap: Record<string, ApiTask> = {};
    (snapshotData.active_tasks || []).forEach((t) => {
      activeTasksMap[t.id] = t;
    });
    set({
      activeTasks: activeTasksMap,
      lastSequenceId: Math.max(get().lastSequenceId, lastSeq || 0),
      backendConnection: "connected",
      backendError: null,
      isLiveConnected: true,
    });
  },

  setActiveWorkflow: (wf: Workflow | null) => set({ activeWorkflow: wf }),
  setIsMemoryCenterOpen: (open: boolean) => set({ isMemoryCenterOpen: open }),
  triggerMemoryRefresh: () => set({ memoryRefreshTrigger: get().memoryRefreshTrigger + 1 }),
  setIsToolCenterOpen: (open: boolean) => set({ isToolCenterOpen: open }),
  triggerToolRefresh: () => set({ toolRefreshTrigger: get().toolRefreshTrigger + 1 }),
  setIsSpecialistRecruitmentOpen: (open: boolean) => set({ isSpecialistRecruitmentOpen: open }),

  triggerTaskHandoff: (fromAgentId: string, toAgentId: string, skillName?: string, taskTitle?: string) => {
    set({
      activeHandoff: {
        id: `handoff_${Date.now()}`,
        fromAgentId,
        toAgentId,
        skillName: skillName || "Handoff",
        taskTitle: taskTitle || "Task Transmission",
        startTime: performance.now() / 1000,
        duration: 2.2,
      },
    });
  },

  clearTaskHandoff: () => set({ activeHandoff: null }),

  applyEvent: (envelope: EventEnvelope) => {
    const { event_id, event_type, sequence_id, agent_id, task_id, payload } = envelope;

    if (get().processedEventIds.includes(event_id)) {
      return;
    }

    if (sequence_id && sequence_id < get().lastSequenceId) {
      console.warn("Out-of-order event discarded:", envelope);
      return;
    }

    set((state) => {
      const nextSequenceId = Math.max(state.lastSequenceId, sequence_id || 0);
      const nextProcessedIds = [event_id, ...state.processedEventIds.slice(0, 199)];
      const nextRecentEvents = [envelope, ...state.recentEvents.slice(0, 49)];

      const updatedTasks = { ...state.activeTasks };
      const updatedAgents = { ...state.agents };
      let updatedWorkflow = state.activeWorkflow ? { ...state.activeWorkflow } : null;

      if (event_type === "task.created") {
        if (payload && payload.task) {
          updatedTasks[payload.task.id] = payload.task;
        }
      } else if (event_type === "task.assigned") {
        if (agent_id && updatedAgents[agent_id]) {
          updatedAgents[agent_id] = {
            ...updatedAgents[agent_id],
            status: "working",
            currentTask: payload?.task_title || "Executing subtask",
          };
        }
      } else if (event_type === "task.completed") {
        if (task_id && updatedTasks[task_id]) {
          delete updatedTasks[task_id];
        }
        if (agent_id && updatedAgents[agent_id]) {
          updatedAgents[agent_id] = {
            ...updatedAgents[agent_id],
            status: "idle",
            currentTask: null,
          };
        }
      } else if (event_type === "tool.execution_started") {
        if (agent_id && updatedAgents[agent_id]) {
          const toolName = payload?.tool_name || "tool";
          updatedAgents[agent_id] = {
            ...updatedAgents[agent_id],
            status: "working",
            currentTask: `🛠️ ${toolName}`,
          };
        }
      } else if (event_type === "tool.awaiting_approval") {
        if (agent_id && updatedAgents[agent_id]) {
          updatedAgents[agent_id] = {
            ...updatedAgents[agent_id],
            status: "waiting_approval",
            currentTask: "⚠️ Tool Authorization Required!",
          };
        }
      }

      return {
        agents: updatedAgents,
        activeTasks: updatedTasks,
        activeWorkflow: updatedWorkflow,
        lastSequenceId: nextSequenceId,
        processedEventIds: nextProcessedIds,
        recentEvents: nextRecentEvents,
      };
    });
  },

  // =========================================================================
  // MASTER PIPELINE: SEQUENTIAL CORPORATE WORKFLOW & TELEMETRY HANDOFF
  // =========================================================================
  executeMissionPipeline: async (userPrompt: string) => {
    const ceoId = "agent-exec-ceo";
    const agents = get().agents;

    // 1. Open Terminal & Add user message
    set({ isMissionTerminalOpen: true, isExecutingMission: true });

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: "user",
      text: userPrompt,
      timestamp: Date.now(),
    };
    set((s) => ({ chatMessages: [...s.chatMessages, userMsg] }));

    // 2. Camera navigates to Executive Suite
    set({
      cameraPreset: "agent",
      cameraTarget: [0, 1.2, -10],
      cameraPosition: [0, 6.5, -4],
    });

    get().updateAgentStatus(ceoId, "working", "⚡ Phân rã mục tiêu chiến lược & Điều phối phòng ban");

    await new Promise((r) => setTimeout(r, 900));

    // 3. Determine custom Execution Queue based on enterprise query
    const lower = userPrompt.toLowerCase();
    let queue: QueueStep[] = [];
    let deliverable: DeliverableArtifact;

    if (lower.includes("docx") || lower.includes("tài liệu") || lower.includes("prd") || lower.includes("pdf")) {
      queue = [
        {
          id: "step_1",
          agentId: "agent-exec-ceo",
          agentName: "Victoria Vance",
          stepTitle: "Phê duyệt định hướng đặc tả PRD và phân bổ tài nguyên",
          skillName: "Executive Governance & Strategy",
          vietnameseSkill: "Hoạch định Chiến Lược Doanh Nghiệp Cấp Cao",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-research-ai",
          agentName: "Dr. Elena Rostova",
          stepTitle: "Nghiên cứu thị trường và tổng hợp tài liệu chuyên sâu",
          skillName: "Market Intelligence & Deep Research",
          vietnameseSkill: "Phân Tích Tri Thức Thị Trường & Dữ Liệu Chuyên Sâu",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-eng-lead",
          agentName: "David Chen",
          stepTitle: "Thẩm định kiến trúc hệ thống và đặc tả kỹ thuật API",
          skillName: "System Architecture & Security Verification",
          vietnameseSkill: "Thẩm Định Kiến Trúc Kỹ Thuật & Bảo Mật Sandbox",
          status: "pending",
        },
        {
          id: "step_4",
          agentId: "agent-support-lead",
          agentName: "Liam O'Connor",
          stepTitle: "Đánh giá tác động dịch vụ khách hàng và cam kết SLA",
          skillName: "Client Success SLA & Operations Assessment",
          vietnameseSkill: "Đánh Giá Tiêu Chuẩn SLA & Tác Động Vận Hành",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "docx",
        title: "Tài Liệu Kỹ Thuật PRD — Autonomous Business Platform",
        filename: "Enterprise_Autonomous_Platform_PRD.docx",
        description: "Tài liệu đặc tả kiến trúc doanh nghiệp (.docx) chuẩn hóa với quy trình kiểm soát rủi ro và các chỉ số SLA vận hành.",
        size: "182 KB",
        content: `# AUTONOMOUS BUSINESS HEADQUARTERS PRD\n\n## 1. Executive Summary\nEnterprise Autonomous Business Platform operating across 8 dedicated corporate departments.\n\n## 2. Departmental Execution Model\n- Executive Suite: Policy governance and authorization\n- Engineering Bay: Sandboxed runtime and verified code execution\n- Research Lab: Vector knowledge graph distillation\n- Finance Office: Ledger auditing and burn rate compliance\n\nApproved by Executive Board.`,
      };
    } else if (lower.includes("xlsx") || lower.includes("excel") || lower.includes("tài chính") || lower.includes("doanh thu")) {
      queue = [
        {
          id: "step_1",
          agentId: "agent-exec-ceo",
          agentName: "Victoria Vance",
          stepTitle: "Xác lập chỉ tiêu tài chính và hạn mức ngân sách quý",
          skillName: "Executive Governance & Strategy",
          vietnameseSkill: "Xác Lập Chỉ Tiêu Tài Chính Cấp Hội Đồng",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-fin-controller",
          agentName: "Julian Thorne",
          stepTitle: "Thiết lập mô hình tài chính động Excel và kiểm toán sổ cái",
          skillName: "Financial Ledger Auditing & Modeling",
          vietnameseSkill: "Kiểm Toán Sổ Cái & Mô Hình Dự Báo Doanh Thu (.xlsx)",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-sales-director",
          agentName: "Marcus Reynolds",
          stepTitle: "Đối chiếu đường ống bán hàng và dự báo tăng trưởng B2B",
          skillName: "Pipeline Forecasting & Deal Analytics",
          vietnameseSkill: "Dự Báo Doanh Thu Khách Hàng Doanh Nghiệp",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "xlsx",
        title: "Mô Hình Tài Chính & Kế Hoạch Ngân Sách Quý",
        filename: "Corporate_Financial_Forecast.xlsx",
        description: "Bảng tính tài chính tự động tính doanh thu, biên lợi nhuận hoạt động, chi phí hạ tầng và tỷ lệ burn rate an toàn.",
        size: "116 KB",
        content: `Quarter,ARR,Operating Expenses,Net Margin,Runway Months\nQ1,$1,250,000,$420,000,66.4%,36\nQ2,$2,480,000,$680,000,72.5%,38\nQ3,$4,100,000,$990,000,75.8%,42\nQ4,$7,350,000,$1,450,000,80.2%,48`,
      };
    } else if (lower.includes("web") || lower.includes("landing") || lower.includes("frontend") || lower.includes("giao diện")) {
      queue = [
        {
          id: "step_1",
          agentId: "agent-mkt-growth",
          agentName: "Sophia Martinez",
          stepTitle: "Xây dựng định vị thương hiệu và cấu trúc trải nghiệm",
          skillName: "Brand Positioning & UX Narrative",
          vietnameseSkill: "Định Vị Nhận Diện Thương Hiệu & Nội Dung Tiếp Thị",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-eng-lead",
          agentName: "David Chen",
          stepTitle: "Phát triển giao diện Web tương tác cao và tối ưu Three.js",
          skillName: "Frontend Engineering & High-Performance WebGL",
          vietnameseSkill: "Kỹ Thuật Giao Diện Hiện Đại & WebGL Canvas",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-ops-recruiter",
          agentName: "Amara Okafor",
          stepTitle: "Kiểm thử vận hành, kiểm tra khả năng chịu tải và bảo mật",
          skillName: "Operations Quality Assurance & Deployment",
          vietnameseSkill: "Kiểm Thử Tích Hợp & Đảm Bảo Vận Hành Trơn Tru",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "web",
        title: "Cổng Thông Tin Doanh Nghiệp — AI Agency Headquarters Portal",
        filename: "Corporate_HQ_Portal.html",
        description: "Giao diện Web tương tác doanh nghiệp chuẩn quốc tế với thẩm mỹ Glassmorphism cao cấp, bảng điều khiển thời gian thực và hoạt họa tinh tế.",
        size: "264 KB",
        previewHtml: `<div style="padding: 28px; background: linear-gradient(135deg, #0f172a, #1e293b); color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; border-radius: 14px; border: 1px solid rgba(59, 130, 246, 0.4); text-align: center;">
          <h1 style="color: #60a5fa; margin-bottom: 8px; letter-spacing: -0.5px;">🏢 AI AGENCY — AUTONOMOUS BUSINESS HEADQUARTERS</h1>
          <p style="color: #cbd5e1; margin-bottom: 18px; font-size: 14px;">Next-Generation Autonomous Corporate Organization Connected to Real AI Runtime</p>
          <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
            <div style="background: rgba(30, 41, 59, 0.8); padding: 10px 16px; border-radius: 8px; border: 1px solid #3b82f6; font-size: 13px;">💎 8 Corporate Departments</div>
            <div style="background: rgba(30, 41, 59, 0.8); padding: 10px 16px; border-radius: 8px; border: 1px solid #10b981; font-size: 13px;">🔒 Executive Board Governance</div>
            <div style="background: rgba(30, 41, 59, 0.8); padding: 10px 16px; border-radius: 8px; border: 1px solid #0ea5e9; font-size: 13px;">⚡ Real Subprocess Sandbox</div>
          </div>
        </div>`,
      };
    } else {
      // Default Multi-Department Cross-Functional Pipeline
      queue = [
        {
          id: "step_1",
          agentId: "agent-exec-ceo",
          agentName: "Victoria Vance",
          stepTitle: "Phê duyệt kế hoạch tổng thể và điều phối các bộ phận",
          skillName: "Executive Governance & Strategy",
          vietnameseSkill: "Hoạch Định Chiến Lược Tổng Thể & Điều Phối Phòng Ban",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-eng-lead",
          agentName: "David Chen",
          stepTitle: "Triển khai mã nguồn lõi trong môi trường sandbox cô lập",
          skillName: "Core Engineering & Subprocess Sandbox Execution",
          vietnameseSkill: "Thực Thi Mã Nguồn Trong Sandbox Cô Lập",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-fin-controller",
          agentName: "Julian Thorne",
          stepTitle: "Kiểm toán ngân sách và đối soát dữ liệu tài chính",
          skillName: "Financial Ledger Auditing & Budget Control",
          vietnameseSkill: "Kiểm Toán Ngân Sách & Ghi Nhận Sổ Cái Doanh Nghiệp",
          status: "pending",
        },
        {
          id: "step_4",
          agentId: "agent-ops-recruiter",
          agentName: "Amara Okafor",
          stepTitle: "Tổng kết quy trình bàn giao và kích hoạt dịch vụ vận hành",
          skillName: "Operations Orchestration & Compliance Verification",
          vietnameseSkill: "Nghiệm Thu Bàn Giao & Bảo Đảm Vận Hành",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "code",
        title: "Báo Cáo Thực Thi Đa Phòng Ban — Enterprise Autonomous Pipeline",
        filename: "Autonomous_Enterprise_Execution.json",
        description: "Bản ghi kiểm toán thực thi hoàn chỉnh với chữ ký số, dữ liệu đối soát tài chính và trạng thái xác nhận từ các phòng ban liên quan.",
        size: "94 KB",
        content: `{\n  "organization": "AI Agency — Autonomous Business Headquarters",\n  "status": "COMPLETED",\n  "executive_signoff": "Victoria Vance (CEO)",\n  "engineering_verification": "Passed sandbox integrity checks",\n  "financial_audit": "Within quarterly budget limits",\n  "operations_compliance": "Verified"\n}`,
      };
    }

    set({ executionQueue: queue });

    // 4. Sequential Step Execution with Corporate Telemetry Handoff
    for (let i = 0; i < queue.length; i++) {
      const currentStep = queue[i];
      const fromAgent = agents[currentStep.agentId];
      const nextStep = queue[i + 1];
      const toAgent = nextStep ? agents[nextStep.agentId] : agents[ceoId];

      set((s) => ({
        executionQueue: s.executionQueue.map((st, idx) =>
          idx === i ? { ...st, status: "moving" } : st
        ),
      }));

      get().updateAgentStatus(currentStep.agentId, "working", currentStep.stepTitle);

      // A. Physical Movement / Focus
      if (fromAgent && toAgent) {
        set({
          movingAgent: {
            agentId: currentStep.agentId,
            fromPos: fromAgent.position,
            targetPos: toAgent.position,
            progress: 0,
          },
        });

        const runDuration = 1200;
        const startRun = Date.now();
        while (Date.now() - startRun < runDuration) {
          const p = Math.min(1.0, (Date.now() - startRun) / runDuration);
          set((s) => (s.movingAgent ? { movingAgent: { ...s.movingAgent, progress: p } } : {}));
          await new Promise((r) => setTimeout(r, 40));
        }

        set({ movingAgent: null });
      }

      // B. Data Handoff Stream
      set((s) => ({
        executionQueue: s.executionQueue.map((st, idx) =>
          idx === i ? { ...st, status: "firing" } : st
        ),
      }));

      get().triggerTaskHandoff(
        currentStep.agentId,
        toAgent.id,
        currentStep.skillName,
        currentStep.stepTitle
      );

      await new Promise((r) => setTimeout(r, 1500));
      get().clearTaskHandoff();

      get().updateAgentStatus(toAgent.id, "working", `Tiếp nhận dữ liệu từ ${currentStep.agentName}`);

      set((s) => ({
        executionQueue: s.executionQueue.map((st, idx) =>
          idx === i ? { ...st, status: "completed" } : st
        ),
      }));

      get().updateAgentStatus(currentStep.agentId, "idle", null);
      await new Promise((r) => setTimeout(r, 350));
    }

    // 5. Final Step: Return to CEO in Executive Suite
    get().triggerTaskHandoff(
      queue[queue.length - 1].agentId,
      ceoId,
      "Executive Sign-off & Delivery",
      "Tổng Hợp Báo Cáo Cấp Hội Đồng"
    );

    await new Promise((r) => setTimeout(r, 1400));
    get().clearTaskHandoff();

    get().updateAgentStatus(ceoId, "idle", null);

    // Add Deliverable to Store
    set((s) => ({
      activeDeliverables: [deliverable, ...s.activeDeliverables],
      isExecutingMission: false,
    }));

    // Post Final Deliverable in Chat
    const finalMsg: ChatMessage = {
      id: `final_${Date.now()}`,
      sender: "ceo",
      agentName: "Victoria Vance (CEO)",
      text: `💼 **NHIỆM VỤ ĐÃ HOÀN TẤT THÀNH CÔNG!** Toàn bộ các phòng ban đã phối hợp nhịp nhàng và hoàn thành đúng tiến độ. Sản phẩm bàn giao **${deliverable.title}** (${deliverable.filename}) đã sẵn sàng để kiểm tra và tải về ngay bên dưới.`,
      timestamp: Date.now(),
      artifact: deliverable,
    };
    set((s) => ({ chatMessages: [...s.chatMessages, finalMsg] }));
  },
}));
