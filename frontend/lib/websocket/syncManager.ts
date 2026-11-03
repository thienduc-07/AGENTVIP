import {
  EventEnvelope,
  WsSnapshotMessage,
  WsEventMessage,
  WsIncomingMessage,
  SyncConnectionState,
  SyncManagerConfig,
  SyncTelemetry,
} from "@/types/events";
import { getAuthToken } from "@/lib/api/client";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

export function isWsOpen(ws: WebSocket | null): boolean {
  return !!ws && ws.readyState === WS_OPEN;
}

export function validateEventEnvelope(raw: any): EventEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.event_id !== "string" || !raw.event_id) return null;
  if (typeof raw.event_type !== "string" || !raw.event_type) return null;

  const sequenceId = typeof raw.sequence_id === "number" ? raw.sequence_id : 0;
  const payload = raw.payload && typeof raw.payload === "object" ? raw.payload : {};

  return {
    schema_version: typeof raw.schema_version === "number" ? raw.schema_version : 1,
    event_id: raw.event_id,
    event_type: raw.event_type,
    occurred_at: typeof raw.occurred_at === "string" ? raw.occurred_at : new Date().toISOString(),
    sequence_id: sequenceId,
    agent_id: typeof raw.agent_id === "string" ? raw.agent_id : null,
    task_id: typeof raw.task_id === "string" ? raw.task_id : null,
    organization_id: typeof raw.organization_id === "string" ? raw.organization_id : null,
    payload,
  };
}

export function validateSnapshotMessage(raw: any): WsSnapshotMessage | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.message_type !== "snapshot") return null;
  if (typeof raw.last_sequence_id !== "number") return null;
  if (!raw.data || typeof raw.data !== "object") return null;

  return {
    message_type: "snapshot",
    snapshot_id: typeof raw.snapshot_id === "string" ? raw.snapshot_id : `snap_${Date.now()}`,
    generated_at: typeof raw.generated_at === "string" ? raw.generated_at : new Date().toISOString(),
    last_sequence_id: raw.last_sequence_id,
    data: {
      agents: Array.isArray(raw.data.agents) ? raw.data.agents : [],
      active_tasks: Array.isArray(raw.data.active_tasks) ? raw.data.active_tasks : [],
    },
  };
}

export type EventCallback = (envelope: EventEnvelope) => void;
export type SnapshotCallback = (snapshot: WsSnapshotMessage) => void;
export type StateChangeCallback = (state: SyncConnectionState, error?: string | null) => void;

export class SyncManager {
  private ws: WebSocket | null = null;
  private config: Required<SyncManagerConfig>;
  private connectionState: SyncConnectionState = "DISCONNECTED";
  private lastAppliedSequenceId: number = 0;
  private snapshotWatermark: number = 0;
  private processedEventIds: Set<string> = new Set();
  private maxProcessedIds: number = 1000;

  private reconnectAttempts: number = 0;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private isIntentionallyClosed: boolean = false;

  private duplicateCount: number = 0;
  private processedCount: number = 0;
  private lastError: string | null = null;

  // Listeners
  private eventListeners: Set<EventCallback> = new Set();
  private snapshotListeners: Set<SnapshotCallback> = new Set();
  private stateListeners: Set<StateChangeCallback> = new Set();

  constructor(config: SyncManagerConfig = {}) {
    const defaultWsUrl =
      typeof window !== "undefined"
        ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/v1/events/ws`
        : "ws://localhost:8000/api/v1/events/ws";

    this.config = {
      wsUrl: config.wsUrl || defaultWsUrl,
      token: config.token ?? null,
      organizationId: config.organizationId ?? null,
      reconnectBaseDelayMs: config.reconnectBaseDelayMs ?? 500,
      reconnectMaxDelayMs: config.reconnectMaxDelayMs ?? 10000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 15000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 5000,
      maxReplayLimit: config.maxReplayLimit ?? 100,
      autoConnect: config.autoConnect ?? false,
    };

    if (this.config.autoConnect) {
      this.connect();
    }
  }

  // --- Subscription Management ---

  public onEvent(callback: EventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  public onSnapshot(callback: SnapshotCallback): () => void {
    this.snapshotListeners.add(callback);
    return () => this.snapshotListeners.delete(callback);
  }

  public onStateChange(callback: StateChangeCallback): () => void {
    this.stateListeners.add(callback);
    callback(this.connectionState, this.lastError);
    return () => this.stateListeners.delete(callback);
  }

  // --- Lifecycle & Connection Control ---

  public connect(): void {
    if (this.connectionState === "CONNECTED" || this.connectionState === "CONNECTING") {
      return;
    }

    this.isIntentionallyClosed = false;
    this.cleanupSocket();
    this.setConnectionState("CONNECTING");

    try {
      const url = this.buildWebSocketUrl();
      const protocols = this.config.token ? [`bearer.${this.config.token}`] : undefined;
      this.ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      this.setupSocketHandlers(this.ws);
    } catch (err: any) {
      this.lastError = err?.message || "Failed to initialize WebSocket";
      this.setConnectionState("ERROR", this.lastError);
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.clearTimers();
    this.cleanupSocket();
    this.setConnectionState("DISCONNECTED");
  }

  public switchTenant(token: string | null, organizationId: string | null): void {
    // Prevent old events from leaking into the new tenant state
    this.disconnect();
    this.config.token = token;
    this.config.organizationId = organizationId;
    this.lastAppliedSequenceId = 0;
    this.snapshotWatermark = 0;
    this.processedEventIds.clear();
    this.reconnectAttempts = 0;
    this.lastError = null;

    // Connect under new tenant session
    this.connect();
  }

  // --- WebSocket Protocol Actions ---

  public requestReplay(lastSeq: number): void {
    if (!isWsOpen(this.ws)) return;
    const msg = {
      action: "replay",
      last_sequence_id: lastSeq,
    };
    this.ws!.send(JSON.stringify(msg));
  }

  public requestResync(): void {
    if (!isWsOpen(this.ws)) return;
    this.setConnectionState("RESYNCING");
    const msg = {
      action: "resync",
    };
    this.ws!.send(JSON.stringify(msg));
  }

  public ping(): void {
    if (!isWsOpen(this.ws)) return;
    const msg = {
      action: "ping",
      payload: { timestamp: Date.now() },
    };
    this.ws!.send(JSON.stringify(msg));
  }

  // --- State Getters & Telemetry ---

  public getState(): SyncConnectionState {
    return this.connectionState;
  }

  public getLastSequenceId(): number {
    return this.lastAppliedSequenceId;
  }

  public setSnapshotWatermark(watermark: number): void {
    if (typeof watermark === "number" && !isNaN(watermark)) {
      this.snapshotWatermark = Math.max(this.snapshotWatermark, watermark);
      this.lastAppliedSequenceId = Math.max(this.lastAppliedSequenceId, watermark);
    }
  }

  public getTelemetry(): SyncTelemetry {
    return {
      connectionState: this.connectionState,
      lastAppliedSequenceId: this.lastAppliedSequenceId,
      snapshotWatermark: this.snapshotWatermark,
      processedEventsCount: this.processedCount,
      duplicateEventsSuppressed: this.duplicateCount,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }

  // --- Internal Socket & Event Ingestion Logic ---

  private buildWebSocketUrl(): string {
    let base = this.config.wsUrl;
    const query = new URLSearchParams();

    const activeToken = this.config.token || getAuthToken();
    if (activeToken) {
      query.set("token", activeToken);
    }
    if (this.config.organizationId) {
      query.set("organization_id", this.config.organizationId);
    }

    const qs = query.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private setupSocketHandlers(socket: WebSocket): void {
    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.setConnectionState("CONNECTED");
      this.startHeartbeat();

      // If we had a previous session with a sequence watermark, request replay
      if (this.lastAppliedSequenceId > 0) {
        this.requestReplay(this.lastAppliedSequenceId);
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      if (this.ws !== socket) return;
      this.handleIncomingRawMessage(event.data);
    };

    socket.onerror = (event: Event) => {
      if (this.ws !== socket) return;
      this.lastError = "WebSocket transport error";
    };

    socket.onclose = (event: CloseEvent) => {
      if (this.ws !== socket) return;
      this.cleanupSocket();

      if (event.code === 1008) {
        // Policy violation / Authentication failure: do not blindly retry in a loop
        this.lastError = "Authentication or tenant authorization rejected (WS 1008)";
        this.setConnectionState("ERROR", this.lastError);
        return;
      }

      if (!this.isIntentionallyClosed) {
        this.scheduleReconnect();
      } else {
        this.setConnectionState("DISCONNECTED");
      }
    };
  }

  public handleIncomingRawMessage(rawData: string | any): void {
    let parsed: any;
    try {
      parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    } catch {
      // Reject malformed JSON without corrupting application state
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    // 1. Authoritative Snapshot Message
    if (parsed.message_type === "snapshot") {
      const validSnapshot = validateSnapshotMessage(parsed);
      if (validSnapshot) {
        // Authoritative hydration: set sequence watermark to snapshot's watermark
        this.snapshotWatermark = Math.max(this.snapshotWatermark, validSnapshot.last_sequence_id);
        this.lastAppliedSequenceId = Math.max(this.lastAppliedSequenceId, validSnapshot.last_sequence_id);
        if (this.connectionState === "RESYNCING") {
          this.setConnectionState("CONNECTED");
        }
        for (const listener of this.snapshotListeners) {
          try {
            listener(validSnapshot);
          } catch (e) {
            console.error("Error in snapshot listener:", e);
          }
        }
      }
      return;
    }

    // 2. Event Message
    if (parsed.message_type === "event" || parsed.event) {
      const rawEnv = parsed.event || parsed;
      const validEnvelope = validateEventEnvelope(rawEnv);
      if (validEnvelope) {
        this.ingestValidatedEvent(validEnvelope);
      }
      return;
    }

    // 3. Pong Heartbeat
    if (parsed.message_type === "pong") {
      return;
    }

    // 4. Server Error Message
    if (parsed.message_type === "error" || parsed.error) {
      this.lastError = parsed.detail || parsed.error || "Server sync error";
      if (parsed.code === "REPLAY_OVERFLOW") {
        // Replay overflow recovery: automatically request authoritative resync
        this.requestResync();
      }
    }
  }

  public ingestValidatedEvent(envelope: EventEnvelope): boolean {
    const { event_id, sequence_id } = envelope;

    // 1. Deduplication check: Has this specific event ID already been applied?
    if (this.processedEventIds.has(event_id)) {
      this.duplicateCount++;
      return false;
    }

    // 2. Authoritative snapshot boundary check:
    // If sequence_id <= snapshotWatermark, this event was already hydrated by the authoritative snapshot.
    if (sequence_id > 0 && this.snapshotWatermark > 0 && sequence_id <= this.snapshotWatermark) {
      this.duplicateCount++;
      return false;
    }

    // 3. Monotonic watermark progression:
    // Update cursor to highest observed sequence ID for future replay requests.
    // Non-contiguous sequence gaps and out-of-order events are safely permitted.
    if (sequence_id > 0) {
      this.lastAppliedSequenceId = Math.max(this.lastAppliedSequenceId, sequence_id);
    }

    // Track processed event ID (bounded LRU-like set)
    this.processedEventIds.add(event_id);
    if (this.processedEventIds.size > this.maxProcessedIds) {
      // Remove oldest entries
      const iterator = this.processedEventIds.values();
      for (let i = 0; i < 100; i++) {
        const val = iterator.next().value;
        if (val) this.processedEventIds.delete(val);
      }
    }

    this.processedCount++;

    // Notify listeners
    for (const listener of this.eventListeners) {
      try {
        listener(envelope);
      } catch (err) {
        console.error("Error in event listener:", err);
      }
    }

    return true;
  }

  private scheduleReconnect(): void {
    this.clearTimers();
    this.setConnectionState("RECONNECTING");

    this.reconnectAttempts++;
    const base = this.config.reconnectBaseDelayMs;
    const max = this.config.reconnectMaxDelayMs;
    // Exponential backoff with randomized jitter
    const exponential = Math.min(max, base * Math.pow(2, this.reconnectAttempts - 1));
    const jitter = Math.random() * (exponential * 0.2);
    const delay = Math.floor(exponential + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.ping();
    }, this.config.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WS_OPEN || this.ws.readyState === WS_CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private setConnectionState(state: SyncConnectionState, error?: string | null): void {
    this.connectionState = state;
    if (error !== undefined) {
      this.lastError = error;
    }
    for (const listener of this.stateListeners) {
      try {
        listener(state, this.lastError);
      } catch (e) {
        console.error("Error in state change listener:", e);
      }
    }
  }
}

// Global singleton instance
export const syncManager = new SyncManager();
