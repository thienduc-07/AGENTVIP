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
  sender: "user" | "luffy" | "agent" | "system";
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
      sender: "luffy",
      agentName: "Monkey D. Luffy (Gear 5)",
      text: "Chào mừng hoa tiêu đã đặt chân tới hòn đảo AI Agent City! Ta là Monkey D. Luffy, Thần Mặt Trời Nika. Toàn bộ 10 thuyền viên Mũ Rơm đã được trang bị đầy đủ 19 Kỹ năng Anthropic chuẩn (docx, xlsx, pptx, pdf, frontend-design, webapp-testing, mcp-builder...). Hãy ra lệnh bất cứ nhiệm vụ nào vào Mission Terminal để ta phân công tác chiến!",
      timestamp: Date.now(),
    },
  ],
  executionQueue: [],
  activeDeliverables: [],
  movingAgent: null,

  agentActivities: {
    "agent-captain-roger": "haki",
    "agent-zoro-quartermaster": "sword_kata",
    "agent-sanji-cook": "cooking",
    "agent-franky-shipwright": "ship_repair",
    "agent-chopper-doctor": "apothecary",
    "agent-nami-navigator": "cartography",
    "agent-usopp-sniper": "sniper_scout",
    "agent-robin-scholar": "cien_fleurs",
    "agent-brook-musician": "violin_concert",
    "agent-jinbe-helmsman": "karate_kata",
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
      cameraTarget: [agent.position[0], agent.position[1] + 0.8, agent.position[2]],
      cameraPosition: [agent.position[0] + 3.2, agent.position[1] + 2.5, agent.position[2] + 4.0],
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
  // MASTER PIPELINE: SEQUENTIAL PHYSICAL + ANIME SKILL VFX HANDOFF ACROSS ISLAND
  // =========================================================================
  executeMissionPipeline: async (userPrompt: string) => {
    const luffyId = "agent-captain-roger";
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

    // 2. Camera flies directly to Luffy at Sun God Plaza in the center
    set({
      cameraPreset: "agent",
      cameraTarget: [0, 5.8, 0],
      cameraPosition: [0, 10.5, 12],
    });

    get().updateAgentStatus(luffyId, "working", "⚡ Phân tích Prompt & Lập Hàng Đợi Tác Chiến");

    await new Promise((r) => setTimeout(r, 900));

    // 3. Determine custom Execution Queue based on user prompt keywords
    const lower = userPrompt.toLowerCase();
    let queue: QueueStep[] = [];
    let deliverable: DeliverableArtifact;

    if (lower.includes("docx") || lower.includes("tài liệu") || lower.includes("prd") || lower.includes("pdf")) {
      queue = [
        {
          id: "step_1",
          agentId: "agent-captain-roger",
          agentName: "Monkey D. Luffy",
          stepTitle: "Phân tích yêu cầu PRD & Chia nhỏ tài liệu kỹ thuật",
          skillName: "Gomu Gomu no Bajrang Gun",
          vietnameseSkill: "Haki Bá Vương Đỏ Đen & Bajrang Gun",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-robin-archaeologist",
          agentName: "Nico Robin",
          stepTitle: "Soạn thảo văn bản chuẩn .docx & .pdf (Anthropic docx skill)",
          skillName: "Mil Fleur: Gigantesco Mano",
          vietnameseSkill: "Nghìn Cánh Hoa: Cánh Tay Khổng Lồ",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-chopper-doctor",
          agentName: "Tony Tony Chopper",
          stepTitle: "Khám nghiệm chính tả, định dạng và tính toàn vẹn tài liệu",
          skillName: "Kokutei Cross / Sakura Blizzard",
          vietnameseSkill: "Cơn Lốc Hoa Anh Đào & Khắc Ấn Móng Guốc",
          status: "pending",
        },
        {
          id: "step_4",
          agentId: "agent-zoro-quartermaster",
          agentName: "Roronoa Zoro",
          stepTitle: "Thẩm định kiến trúc kỹ thuật hệ thống backend",
          skillName: "103 Mercies Dragon Damnation",
          vietnameseSkill: "Tam Kiếm Phái: Diêm Vương Phi Long Tuyệt Chiêu",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "docx",
        title: "Tài Liệu Đặc Tả Kỹ Thuật PRD — Hệ Thống Multi-Agent Grand Line",
        filename: "GrandLine_System_PRD.docx",
        description: "Tài liệu kỹ thuật định dạng Microsoft Word (.docx) được tạo tự động bởi Nico Robin bằng kỹ năng Anthropic docx skill.",
        size: "148 KB",
        content: `# GRAND LINE MULTI-AGENT SPECIFICATION\n\n## 1. System Overview\nAutonomous 10-Agent Straw Hat World integrated with Anthropic Skills.\n\n## 2. Architecture\n- Realtime WebSocket Events\n- GLSL Particle Handoff Shaders\n- Automated Sandboxed File Generation\n\nGenerated with Straw Hat Fleet.`,
      };
    } else if (lower.includes("xlsx") || lower.includes("excel") || lower.includes("tài chính") || lower.includes("doanh thu")) {
      queue = [
        {
          id: "step_1",
          agentId: "agent-captain-roger",
          agentName: "Monkey D. Luffy",
          stepTitle: "Hoạch định mục tiêu kinh doanh & Ngân sách hải tặc",
          skillName: "Gomu Gomu no Bajrang Gun",
          vietnameseSkill: "Haki Bá Vương Đỏ Đen & Bajrang Gun",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-nami-navigator",
          agentName: "Nami",
          stepTitle: "Lập bảng tính tài chính Excel với công thức động (Anthropic xlsx skill)",
          skillName: "Raitei (Zeus Breeze Tempo)",
          vietnameseSkill: "Lôi Đình Zeus Breeze Tempo",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-robin-archaeologist",
          agentName: "Nico Robin",
          stepTitle: "Tổng hợp báo cáo thuyết trình PowerPoint (Anthropic pptx skill)",
          skillName: "Mil Fleur: Gigantesco Mano",
          vietnameseSkill: "Nghìn Cánh Hoa: Cánh Tay Khổng Lồ",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "xlsx",
        title: "Bảng Tính Mô Hình Tài Chính & Dự Báo Hải Trình",
        filename: "StrawHat_Financial_Model.xlsx",
        description: "Bảng tính Microsoft Excel (.xlsx) với công thức tự động tính ROI, chi phí vận hành tàu Thousand Sunny và doanh thu kho báu.",
        size: "92 KB",
        content: `Q1,Q2,Q3,Q4\nBeli Revenue: 15000000, 28000000, 45000000, 95000000\nNet Profit: 12000000, 24000000, 39000000, 82000000`,
      };
    } else if (lower.includes("web") || lower.includes("landing") || lower.includes("frontend") || lower.includes("giao diện")) {
      queue = [
        {
          id: "step_1",
          agentId: "agent-captain-roger",
          agentName: "Monkey D. Luffy",
          stepTitle: "Duyệt định hướng trải nghiệm người dùng & Wireframe",
          skillName: "Gomu Gomu no Bajrang Gun",
          vietnameseSkill: "Haki Bá Vương Đỏ Đen & Bajrang Gun",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-sanji-cook",
          agentName: "Vinsmoke Sanji",
          stepTitle: "Thiết kế WebGL Glassmorphism & UI Component (Anthropic frontend-design)",
          skillName: "Ifrit Jambe: Boeuf Burst",
          vietnameseSkill: "Cước Lửa Quỷ Ifrit: Boeuf Burst",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-usopp-sniper",
          agentName: "God Usopp",
          stepTitle: "Kiểm thử tự động End-to-End với Playwright (Anthropic webapp-testing)",
          skillName: "Hissatsu: Firebird Star",
          vietnameseSkill: "Tất Sát: Hỏa Điểu Tinh",
          status: "pending",
        },
        {
          id: "step_4",
          agentId: "agent-franky-shipwright",
          agentName: "Franky",
          stepTitle: "Đóng gói Docker Container & Deploy Production Bundle",
          skillName: "Franky Radical Beam",
          vietnameseSkill: "Chùm Laser Radical Beam BF-38",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "web",
        title: "Ứng Dụng WebGL Landing Page — Straw Hat Metaverse",
        filename: "StrawHat_LandingPage.html",
        description: "Giao diện Web tương tác cao cấp với Glassmorphism, Three.js 3D Canvas và hiệu ứng micro-animation mượt mà.",
        size: "312 KB",
        previewHtml: `<div style="padding: 24px; background: linear-gradient(135deg, #090d16, #0f172a); color: white; font-family: sans-serif; border-radius: 12px; border: 1px solid rgba(245, 158, 11, 0.4); text-align: center;">
          <h1 style="color: #f59e0b; margin-bottom: 8px;">👑 STRAW HAT FLEET COMMAND</h1>
          <p style="color: #94a3b8; margin-bottom: 16px;">Next-Gen WebGL AI Agent System Powered by Anthropic Skills</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <div style="background: rgba(30, 41, 59, 0.8); padding: 12px; border-radius: 8px; border: 1px solid #38bdf8;">⚡ 10 Awakened Agents</div>
            <div style="background: rgba(30, 41, 59, 0.8); padding: 12px; border-radius: 8px; border: 1px solid #10b981;">🛡️ 19 Anthropic Skills</div>
            <div style="background: rgba(30, 41, 59, 0.8); padding: 12px; border-radius: 8px; border: 1px solid #ec4899;">🌸 Realtime 3D Island</div>
          </div>
        </div>`,
      };
    } else {
      // Default Multi-Agent Full Fleet Chain
      queue = [
        {
          id: "step_1",
          agentId: "agent-captain-roger",
          agentName: "Monkey D. Luffy",
          stepTitle: "Phân bổ chiến lược liên minh đa agent",
          skillName: "Gomu Gomu no Bajrang Gun",
          vietnameseSkill: "Haki Bá Vương Đỏ Đen & Bajrang Gun",
          status: "pending",
        },
        {
          id: "step_2",
          agentId: "agent-zoro-quartermaster",
          agentName: "Roronoa Zoro",
          stepTitle: "Xây dựng MCP Server & Core Algorithms (Anthropic mcp-builder)",
          skillName: "103 Mercies Dragon Damnation",
          vietnameseSkill: "Tam Kiếm Phái: Diêm Vương Phi Long Tuyệt Chiêu",
          status: "pending",
        },
        {
          id: "step_3",
          agentId: "agent-sanji-cook",
          agentName: "Vinsmoke Sanji",
          stepTitle: "Kiến trúc Frontend & Tối ưu hiệu ứng UI (Anthropic theme-factory)",
          skillName: "Ifrit Jambe: Boeuf Burst",
          vietnameseSkill: "Cước Lửa Quỷ Ifrit: Boeuf Burst",
          status: "pending",
        },
        {
          id: "step_4",
          agentId: "agent-franky-shipwright",
          agentName: "Franky",
          stepTitle: "Đóng gói sản phẩm hoàn chỉnh & Triển khai thực tế",
          skillName: "Franky Radical Beam",
          vietnameseSkill: "Chùm Laser Radical Beam BF-38",
          status: "pending",
        },
      ];
      deliverable = {
        id: `art_${Date.now()}`,
        type: "code",
        title: "Gói Mã Nguồn MCP Server & Fullstack Agent Pipeline",
        filename: "strawhat_mcp_server.py",
        description: "Bộ mã nguồn hoàn chỉnh tích hợp MCP Server chuẩn Anthropic với khả năng kết nối cơ sở dữ liệu và gọi công cụ đa năng.",
        size: "76 KB",
        content: `from mcp.server.fastmcp import FastMCP\n\nmcp = FastMCP("StrawHatServer")\n\n@mcp.tool()\ndef execute_grand_line_mission(prompt: str) -> str:\n    return f"Mission '{prompt}' executed successfully across all 10 Straw Hat Agents!"\n\nif __name__ == "__main__":\n    mcp.run()`,
      };
    }

    set({ executionQueue: queue });

    // 4. Sequential Step Execution with Physical Movement & Anime Skill VFX Handoff (Visual only on 3D island)
    for (let i = 0; i < queue.length; i++) {
      const currentStep = queue[i];
      const fromAgent = agents[currentStep.agentId];
      const nextStep = queue[i + 1];
      const toAgent = nextStep ? agents[nextStep.agentId] : agents[luffyId];

      // Mark current step as active/moving
      set((s) => ({
        executionQueue: s.executionQueue.map((st, idx) =>
          idx === i ? { ...st, status: "moving" } : st
        ),
      }));

      get().updateAgentStatus(currentStep.agentId, "working", currentStep.stepTitle);

      // A. Physical Movement: character runs across island towards next target
      if (fromAgent && toAgent) {
        // Set moving agent state for 3D lerping (Camera stays 100% under user control)
        set({
          movingAgent: {
            agentId: currentStep.agentId,
            fromPos: fromAgent.position,
            targetPos: toAgent.position,
            progress: 0,
          },
        });

        // Animate running progress over 1.4 seconds
        const runDuration = 1400;
        const startRun = Date.now();
        while (Date.now() - startRun < runDuration) {
          const p = Math.min(1.0, (Date.now() - startRun) / runDuration);
          set((s) => (s.movingAgent ? { movingAgent: { ...s.movingAgent, progress: p } } : {}));
          await new Promise((r) => setTimeout(r, 40));
        }

        set({ movingAgent: null });
      }

      // B. Unleash Ultimate Anime Skill VFX Projectile (GLSL custom shaders + THREE.Points)
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

      // Wait 1.8s for projectile arc to reach recipient
      await new Promise((r) => setTimeout(r, 1800));

      get().clearTaskHandoff();

      // Recipient receives payload and plays execution
      get().updateAgentStatus(toAgent.id, "working", `Tiếp nhận gói công việc từ ${currentStep.agentName}`);

      // Complete this step
      set((s) => ({
        executionQueue: s.executionQueue.map((st, idx) =>
          idx === i ? { ...st, status: "completed" } : st
        ),
      }));

      get().updateAgentStatus(currentStep.agentId, "idle", null);
      await new Promise((r) => setTimeout(r, 400));
    }

    // 5. Final Step: Return to Luffy at Sun God Plaza & Synthesize Products
    get().triggerTaskHandoff(
      queue[queue.length - 1].agentId,
      luffyId,
      "Gomu Gomu no Bajrang Gun",
      "Tổng Hợp Sản Phẩm Cuối Cùng"
    );

    await new Promise((r) => setTimeout(r, 1600));
    get().clearTaskHandoff();

    get().updateAgentStatus(luffyId, "idle", null);

    // Add Deliverable to Store
    set((s) => ({
      activeDeliverables: [deliverable, ...s.activeDeliverables],
      isExecutingMission: false,
    }));

    // Post Final Deliverable in Chat (Only user query and final deliverable product displayed in chat)
    const finalMsg: ChatMessage = {
      id: `final_${Date.now()}`,
      sender: "luffy",
      agentName: "Monkey D. Luffy (Gear 5)",
      text: `🎉 **NHIỆM VỤ HOÀN TẤT XUẤT SẮC!** Toàn bộ 10 thành viên băng Mũ Rơm đã phối hợp đồng bộ. Sản phẩm **${deliverable.title}** (${deliverable.filename}) đã sẵn sàng để xem trực tiếp và tải về ngay bên dưới!`,
      timestamp: Date.now(),
      artifact: deliverable,
    };
    set((s) => ({ chatMessages: [...s.chatMessages, finalMsg] }));
  },
}));
