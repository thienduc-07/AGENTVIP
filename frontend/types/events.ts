import { ApiAgent, ApiTask } from "./api";

export type BackendEventType =
  | "task.created"
  | "task.assigned"
  | "task.status_changed"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "tool.execution_started"
  | "tool.awaiting_approval"
  | "tool.approval_granted"
  | "tool.approval_rejected"
  | "tool.execution_completed"
  | "agent.status_updated"
  | "agent.behavioral_state_changed"
  | "agent.movement_started"
  | "agent.movement_progress"
  | "agent.movement_completed"
  | "agent.movement_interrupted"
  | "agent.recruited"
  | "agent.reassigned"
  | "workstation.allocated"
  | "workstation.reassigned"
  | "workstation.released"
  | "ceo.heartbeat_started"
  | "ceo.heartbeat_completed"
  | "ceo.heartbeat_failed"
  | (string & {});

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

export interface WsErrorMessage {
  message_type?: "error";
  code?: string;
  detail?: string;
  error?: string;
}

export type WsIncomingMessage =
  | WsSnapshotMessage
  | WsEventMessage
  | WsPongMessage
  | WsErrorMessage;

export type SyncConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "RESYNCING"
  | "ERROR";

export interface SyncManagerConfig {
  wsUrl?: string;
  token?: string | null;
  organizationId?: string | null;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxReplayLimit?: number;
  autoConnect?: boolean;
}

export interface SyncTelemetry {
  connectionState: SyncConnectionState;
  lastAppliedSequenceId: number;
  snapshotWatermark?: number;
  processedEventsCount: number;
  duplicateEventsSuppressed: number;
  reconnectAttempts: number;
  lastError: string | null;
}

