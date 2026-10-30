export type AgentStatus = 
  | "IDLE" 
  | "THINKING" 
  | "EXECUTING_TOOL" 
  | "AWAITING_APPROVAL" 
  | "COMPLETED" 
  | "FAILED";

export type WorldAgentStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "error"
  | "offline";

export interface AgentCharacterData {
  id: string;
  name: string;
  role: string;
  station: string;
  position: [number, number, number];
  status: WorldAgentStatus;
  currentTask?: string | null;
  appearance: "executive-ceo" | "engineer-lead" | "researcher-lead" | "marketing-lead" | "sales-lead" | "finance-lead" | "operations-lead" | "support-lead" | string;
  color: string;
  description?: string;
  capabilities?: string[];
  isDemo?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  station: string;
  status: AgentStatus;
  current_task_id?: string | null;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  color: string;
  avatar: string;
  description?: string;
}

export interface DepartmentArea {
  id: string;
  name: string;
  title: string;
  description: string;
  purpose: string;
  position: [number, number, number];
  cameraTarget: [number, number, number];
  cameraPosition: [number, number, number];
  assignedAgentId: string;
  accentColor: string;
  features: string[];
}

export type IslandArea = DepartmentArea;

export type TaskStatus = 
  | "PENDING" 
  | "IN_PROGRESS" 
  | "AWAITING_APPROVAL" 
  | "COMPLETED" 
  | "FAILED" 
  | "CANCELLED";

export interface EventLog {
  id: string;
  task_id: string;
  agent_id: string;
  event_type: string;
  payload: any;
  timestamp: string;
}

export interface PendingAction {
  id: string;
  task_id: string;
  agent_id: string;
  agent_name?: string;
  tool_name: string;
  tool_args: Record<string, any>;
  risk_reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
}

export interface Task {
  id: string;
  agent_id: string;
  prompt: string;
  status: TaskStatus;
  risk_level: "SAFE" | "LOW" | "HIGH";
  result?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
  events?: EventLog[];
  pending_actions?: PendingAction[];
}

export interface SystemStatus {
  platform: string;
  python_version: string;
  cpu_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  memory_percent: number;
  disk_free_gb: number;
  disk_percent: number;
  sandbox_path?: string;
}

export interface ToolItem {
  name: string;
  description: string;
  risk_level: "SAFE" | "HIGH";
  risk_reason?: string;
  parameters: Record<string, any>;
}
