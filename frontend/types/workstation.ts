/**
 * PROVIPAGENT Phase 4.3.6: Workstation Screen & Live Terminal Types
 */

export type ExecutionStatus = "running" | "completed" | "failed" | "cancelled" | "paused";

export type TerminalStreamType = "stdout" | "stderr" | "system";

export type WorkstationScreenTab = "overview" | "terminal" | "files" | "activity" | "details";

export interface ApiExecution {
  id: string;
  organization_id: string;
  agent_id: string;
  task_id?: string | null;
  status: ExecutionStatus;
  started_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  summary?: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  tool_calls_count: number;
  total_lines: number;
  files_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiTerminalLine {
  id: string;
  execution_id: string;
  sequence_number: number;
  stream: TerminalStreamType;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown> | null;
}

export interface TerminalHistoryResponse {
  execution_id: string;
  total_lines: number;
  lines: ApiTerminalLine[];
}

export interface ApiToolActivity {
  tool_call_id: string;
  tool_name: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  arguments?: Record<string, unknown> | string;
  result_summary?: string;
  error_message?: string;
  duration_ms?: number;
  started_at: string;
  completed_at?: string;
}

export interface ApiFileOperation {
  path: string;
  operation: "read" | "write" | "edit" | "delete";
  size_bytes?: number;
  timestamp: string;
  summary?: string;
}

export interface WorkstationAllocationInfo {
  id: string;
  logical_workstation_id: string;
  department: string;
  office_zone: string;
  desk_number: number;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  allocation_status: string;
  is_virtual: boolean;
}

export interface WorkstationLiveDetail {
  agent_id: string;
  agent_name: string;
  agent_role: string;
  agent_status: string;
  behavioral_state: string;
  current_task_id?: string | null;
  current_task_title?: string | null;
  workstation?: WorkstationAllocationInfo | null;
  active_execution?: ApiExecution | null;
  recent_terminal_lines: ApiTerminalLine[];
  recent_events: Array<{
    id: string;
    event_type: string;
    sequence_number: number;
    execution_id?: string | null;
    agent_id?: string | null;
    task_id?: string | null;
    message: string;
    payload?: Record<string, unknown> | null;
    created_at: string;
  }>;
}

export interface ExecutionListResponse {
  total: number;
  items: ApiExecution[];
}
