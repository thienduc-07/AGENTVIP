export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  error: ApiErrorDetail;
}

export type WorldAgentStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "error"
  | "offline";

export type AgentBehavioralState =
  | "IDLE"
  | "PLANNING"
  | "THINKING"
  | "WORKING"
  | "COMMUNICATING"
  | "MOVING"
  | "WAITING"
  | "COMPLETED"
  | "ERROR";

export interface ApiAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  station: string;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  target_pos_x?: number | null;
  target_pos_y?: number | null;
  target_pos_z?: number | null;
  target_destination?: string | null;
  active_movement_id?: string | null;
  color?: string;
  avatar?: string;
  status: WorldAgentStatus;
  behavioral_state?: AgentBehavioralState | string;
  current_task_id?: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at?: string | null;
}

export type TaskStatus =
  | "created"
  | "planning"
  | "ready"
  | "assigned"
  | "queued"
  | "running"
  | "in_progress"
  | "waiting"
  | "waiting_approval"
  | "review"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface StructuredDeliverable {
  deliverable_id: string;
  task_id: string;
  parent_task_id?: string | null;
  agent_id: string;
  organization_id: string;
  execution_id: string;
  objective: string;
  actions_performed: string[];
  tools_invoked: any[];
  evidence_references: string[];
  result_summary: string;
  artifact_paths: string[];
  artifact_hashes?: Record<string, string>;
  verification_status: "VERIFIED" | "PARTIALLY_VERIFIED" | "FAILED" | "PENDING_REVIEW";
  verification_notes?: string | null;
  completion_timestamp: string;
}

export interface ApiTask {
  id: string;
  idempotency_key?: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_agent_id: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
  error_message?: string | null;
  result_summary?: string | null;
}

export interface CreateTaskRequest {
  id?: string;
  idempotency_key?: string;
  title: string;
  description: string;
  assigned_agent_id: string;
  priority?: TaskPriority;
}


export interface TaskCancelResponse {
  id: string;
  status: TaskStatus;
  message: string;
}

export interface ApiTaskStep {
  id: string;
  task_id: string;
  step_index: number;
  title: string;
  description?: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
}

export interface ApiEvent {
  id: string;
  event_type: string;
  agent_id?: string | null;
  task_id?: string | null;
  payload_json?: Record<string, any> | null;
  created_at: string;
}

export interface EventEnvelope {
  schema_version: number;
  event_id: string;
  event_type: string;
  occurred_at: string;
  sequence_id: number;
  agent_id: string | null;
  task_id: string | null;
  organization_id?: string | null;
  payload: Record<string, any>;
}

export interface WsSnapshotData {
  agents: ApiAgent[];
  active_tasks: ApiTask[];
}

export interface WsSnapshotMessage {
  message_type: "snapshot";
  snapshot_id: string;
  generated_at: string;
  last_sequence_id: number;
  data: WsSnapshotData;
}

export interface WsEventMessage {
  message_type: "event";
  event: EventEnvelope;
  type?: string;
  data?: Record<string, any>;
}

export interface WsPongMessage {
  message_type: "pong";
  timestamp?: number;
}

export type WsIncomingMessage =
  | WsSnapshotMessage
  | WsEventMessage
  | WsPongMessage
  | { error: string; [key: string]: any };

// Milestone 6: Multi-Agent Workflow Types
export interface Subtask {
  id: string;
  parent_task_id?: string | null;
  title: string;
  description: string;
  status: "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";
  assigned_agent_id: string;
  agent_type?: string | null;
  dependencies: string[];
  input_data?: Record<string, any>;
  output_data?: Record<string, any>;
  retry_count: number;
  max_retries: number;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  result_summary?: string | null;
}

export interface Workflow {
  id: string;
  title: string;
  description: string;
  task_type: "workflow";
  status: TaskStatus;
  priority: TaskPriority;
  assigned_agent_id: string;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  result_summary?: string | null;
  error_message?: string | null;
  subtasks: Subtask[];
}

export interface CreateWorkflowRequest {
  title: string;
  description: string;
  assigned_agent_id?: string;
  priority?: TaskPriority;
}

export interface AgentDefinitionItem {
  agent_type: string;
  display_name: string;
  description: string;
  system_prompt: string;
  allowed_tools: string[];
  permission_level: number;
  enabled: boolean;
  concurrency_limit: number;
  default_assigned_agent_id: string;
}

