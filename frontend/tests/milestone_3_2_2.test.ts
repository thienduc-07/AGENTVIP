import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SyncManager, validateEventEnvelope, validateSnapshotMessage } from "@/lib/websocket/syncManager";
import { EventEnvelope, WsSnapshotMessage } from "@/types/events";

// Mock WebSocket class for testing lifecycle and messages
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = 0; // 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    this.readyState = 0;
    MockWebSocket.instances.push(this);
    // Simulate async connection
    setTimeout(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        if (this.onopen) this.onopen({} as any);
      }
    }, 10);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code: number = 1000, reason: string = "Normal closure") {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code, reason, wasClean: true } as any);
  }

  // Test helper to simulate incoming server message
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: typeof data === "string" ? data : JSON.stringify(data) });
    }
  }

  // Test helper to simulate server close
  simulateClose(code: number = 1000, reason: string = "") {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code, reason, wasClean: code === 1000 } as any);
    }
  }
}

describe("Milestone 3.2.2: Real-Time Event Synchronization Engine", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (global as any).WebSocket = MockWebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
  });

  describe("A. Validation & Malformed Payload Handling", () => {
    it("should accept valid EventEnvelope structure", () => {
      const valid = validateEventEnvelope({
        schema_version: 1,
        event_id: "evt_12345",
        event_type: "task.created",
        occurred_at: "2026-11-01T03:00:00Z",
        sequence_id: 105,
        agent_id: "agent-eng-lead",
        task_id: "task_001",
        payload: { title: "Fix cache" },
      });

      expect(valid).not.toBeNull();
      expect(valid?.event_id).toBe("evt_12345");
      expect(valid?.sequence_id).toBe(105);
      expect(valid?.payload).toEqual({ title: "Fix cache" });
    });

    it("should reject malformed event payloads safely without throwing", () => {
      expect(validateEventEnvelope(null)).toBeNull();
      expect(validateEventEnvelope(undefined)).toBeNull();
      expect(validateEventEnvelope("not an object")).toBeNull();
      expect(validateEventEnvelope({})).toBeNull();
      expect(validateEventEnvelope({ event_id: "evt_1" })).toBeNull(); // Missing event_type
      expect(validateEventEnvelope({ event_type: "task.created" })).toBeNull(); // Missing event_id
    });

    it("should accept valid WsSnapshotMessage structure", () => {
      const valid = validateSnapshotMessage({
        message_type: "snapshot",
        snapshot_id: "snap_999",
        generated_at: "2026-11-01T03:00:00Z",
        last_sequence_id: 450,
        data: {
          agents: [{ id: "agent_1", name: "David Chen" }],
          active_tasks: [{ id: "task_1", status: "running" }],
        },
      });

      expect(valid).not.toBeNull();
      expect(valid?.last_sequence_id).toBe(450);
      expect(valid?.data.agents.length).toBe(1);
      expect(valid?.data.active_tasks.length).toBe(1);
    });

    it("should reject malformed snapshot messages", () => {
      expect(validateSnapshotMessage(null)).toBeNull();
      expect(validateSnapshotMessage({ message_type: "not_snapshot" })).toBeNull();
      expect(validateSnapshotMessage({ message_type: "snapshot" })).toBeNull(); // missing last_sequence_id
      expect(validateSnapshotMessage({ message_type: "snapshot", last_sequence_id: "not_number" })).toBeNull();
    });
  });

  describe("B. Connection Lifecycle & Snapshot Hydration", () => {
    it("should connect, advance state to CONNECTED, and hydrate from snapshot", async () => {
      const sync = new SyncManager({
        wsUrl: "ws://localhost:8000/api/v1/events/ws",
        token: "mock_jwt_token",
        organizationId: "org_alpha",
      });

      let observedState = "";
      sync.onStateChange((state) => {
        observedState = state;
      });

      let receivedSnapshot: WsSnapshotMessage | null = null;
      sync.onSnapshot((snap) => {
        receivedSnapshot = snap;
      });

      sync.connect();
      expect(observedState).toBe("CONNECTING");

      // Advance timers for MockWebSocket onopen
      vi.advanceTimersByTime(20);
      expect(observedState).toBe("CONNECTED");

      const wsInstance = MockWebSocket.instances[0];
      expect(wsInstance.url).toContain("token=mock_jwt_token");
      expect(wsInstance.url).toContain("organization_id=org_alpha");

      // Simulate server sending initial snapshot
      wsInstance.simulateMessage({
        message_type: "snapshot",
        snapshot_id: "snap_init_1",
        last_sequence_id: 50,
        data: {
          agents: [{ id: "agent_1", name: "Agent 1" }],
          active_tasks: [{ id: "task_1", title: "Task 1" }],
        },
      });

      expect(receivedSnapshot).not.toBeNull();
      expect((receivedSnapshot as unknown as WsSnapshotMessage)?.last_sequence_id).toBe(50);
      expect(sync.getLastSequenceId()).toBe(50);

      sync.disconnect();
    });
  });

  describe("C. Sequence Semantics, Deduplication & Non-Contiguous Tenant Gaps", () => {
    it("should accept live events and update monotonic sequence watermark", () => {
      const sync = new SyncManager({ autoConnect: false });
      const eventsReceived: EventEnvelope[] = [];
      sync.onEvent((ev) => eventsReceived.push(ev));

      // Ingest sequence 10
      const ok1 = sync.ingestValidatedEvent({
        schema_version: 1,
        event_id: "evt_10",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 10,
        agent_id: "agent_1",
        task_id: "task_1",
        payload: {},
      });

      expect(ok1).toBe(true);
      expect(sync.getLastSequenceId()).toBe(10);
      expect(eventsReceived.length).toBe(1);

      // Ingest non-contiguous sequence 15 (e.g., sequence 11-14 consumed by other tenants)
      // Must NOT be dropped due to non-contiguous ID!
      const ok2 = sync.ingestValidatedEvent({
        schema_version: 1,
        event_id: "evt_15",
        event_type: "task.assigned",
        occurred_at: new Date().toISOString(),
        sequence_id: 15,
        agent_id: "agent_1",
        task_id: "task_1",
        payload: {},
      });

      expect(ok2).toBe(true);
      expect(sync.getLastSequenceId()).toBe(15);
      expect(eventsReceived.length).toBe(2);
    });

    it("should suppress duplicate events with identical event_id", () => {
      const sync = new SyncManager({ autoConnect: false });
      const eventsReceived: EventEnvelope[] = [];
      sync.onEvent((ev) => eventsReceived.push(ev));

      const eventPayload: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_dup_1",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 20,
        agent_id: "agent_1",
        task_id: "task_1",
        payload: {},
      };

      const firstPass = sync.ingestValidatedEvent(eventPayload);
      const secondPass = sync.ingestValidatedEvent(eventPayload);

      expect(firstPass).toBe(true);
      expect(secondPass).toBe(false); // Duplicate suppressed!
      expect(eventsReceived.length).toBe(1);
      expect(sync.getTelemetry().duplicateEventsSuppressed).toBe(1);
    });

    it("should suppress events with sequence_id older than snapshot watermark", () => {
      const sync = new SyncManager({ autoConnect: false });
      // Hydrate watermark to 100 from snapshot
      sync.handleIncomingRawMessage({
        message_type: "snapshot",
        snapshot_id: "snap_100",
        last_sequence_id: 100,
        data: { agents: [], active_tasks: [] },
      });
      expect(sync.getLastSequenceId()).toBe(100);

      // Incoming event with sequence 85 (already included in snapshot)
      const applied = sync.ingestValidatedEvent({
        schema_version: 1,
        event_id: "evt_old_85",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 85,
        agent_id: "agent_1",
        task_id: "task_1",
        payload: {},
      });

      expect(applied).toBe(false);
      expect(sync.getLastSequenceId()).toBe(100);
    });
  });

  describe("D. Reconnection & Replay Request", () => {
    it("should request replay of missed events upon reconnection after watermark established", () => {
      const sync = new SyncManager({
        token: "mock_token",
        organizationId: "org_alpha",
      });

      sync.connect();
      vi.advanceTimersByTime(20);

      const wsInstance = MockWebSocket.instances[0];

      // Hydrate with sequence watermark 40
      wsInstance.simulateMessage({
        message_type: "snapshot",
        last_sequence_id: 40,
        data: { agents: [], active_tasks: [] },
      });
      expect(sync.getLastSequenceId()).toBe(40);

      // Simulate abnormal network disconnect
      wsInstance.simulateClose(1006, "Abnormal closure");
      expect(sync.getState()).toBe("RECONNECTING");

      // Advance timers for exponential backoff + jitter
      vi.advanceTimersByTime(2000);

      // New socket instance created for reconnect
      expect(MockWebSocket.instances.length).toBe(2);
      const reconnectSocket = MockWebSocket.instances[1];

      // Simulate reconnect socket opening
      vi.advanceTimersByTime(20);
      expect(sync.getState()).toBe("CONNECTED");

      // Verify that syncManager automatically requested replay after sequence 40
      const lastSent = JSON.parse(reconnectSocket.sentMessages[0]);
      expect(lastSent.action).toBe("replay");
      expect(lastSent.last_sequence_id).toBe(40);

      sync.disconnect();
    });

    it("should handle 1008 policy violation by terminating reconnect and entering ERROR state", () => {
      const sync = new SyncManager({
        token: "expired_token",
        organizationId: "org_alpha",
      });

      let state = "";
      sync.onStateChange((s) => {
        state = s;
      });

      sync.connect();
      vi.advanceTimersByTime(20);

      const wsInstance = MockWebSocket.instances[0];
      // Server closes with 1008 Policy Violation (Auth Expired)
      wsInstance.simulateClose(1008, "Policy violation: Token expired");

      expect(state).toBe("ERROR");
      expect(sync.getTelemetry().lastError).toContain("1008");

      // Ensure it does NOT blindly schedule a reconnect loop
      vi.advanceTimersByTime(10000);
      expect(MockWebSocket.instances.length).toBe(1);

      sync.disconnect();
    });
  });

  describe("E. Replay Overflow & Authoritative Resynchronization", () => {
    it("should trigger resync request when REPLAY_OVERFLOW error received", () => {
      const sync = new SyncManager({
        token: "token",
        organizationId: "org_alpha",
      });

      sync.connect();
      vi.advanceTimersByTime(20);

      const wsInstance = MockWebSocket.instances[0];

      // Server sends replay overflow notification
      wsInstance.simulateMessage({
        message_type: "error",
        code: "REPLAY_OVERFLOW",
        detail: "Requested events exceed retention window",
      });

      expect(sync.getState()).toBe("RESYNCING");

      // Verify that syncManager dispatched {"action": "resync"}
      const resyncMsg = JSON.parse(wsInstance.sentMessages[wsInstance.sentMessages.length - 1]);
      expect(resyncMsg.action).toBe("resync");

      // Server responds with fresh snapshot
      wsInstance.simulateMessage({
        message_type: "snapshot",
        snapshot_id: "snap_resync_authoritative",
        last_sequence_id: 888,
        data: { agents: [], active_tasks: [] },
      });

      expect(sync.getState()).toBe("CONNECTED");
      expect(sync.getLastSequenceId()).toBe(888);

      sync.disconnect();
    });
  });

  describe("F. Tenant Switching & Multi-Tenant Cache Isolation", () => {
    it("should close old connection, clear watermark and cache, and connect fresh on switchTenant", () => {
      const sync = new SyncManager({
        token: "token_tenant_a",
        organizationId: "org_tenant_a",
      });

      sync.connect();
      vi.advanceTimersByTime(20);

      const socketA = MockWebSocket.instances[0];
      sync.ingestValidatedEvent({
        schema_version: 1,
        event_id: "evt_tenant_a_1",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 300,
        agent_id: "agent_a",
        task_id: "task_a",
        payload: {},
      });

      expect(sync.getLastSequenceId()).toBe(300);

      // Now switch tenant to tenant B
      sync.switchTenant("token_tenant_b", "org_tenant_b");

      // Verify old socket closed
      expect(socketA.readyState).toBe(3);

      // Verify sequence watermark and processed cache reset to 0
      expect(sync.getLastSequenceId()).toBe(0);
      expect(sync.getTelemetry().lastAppliedSequenceId).toBe(0);

      // Advance timers for new socket connection
      vi.advanceTimersByTime(20);
      expect(MockWebSocket.instances.length).toBe(2);
      const socketB = MockWebSocket.instances[1];
      expect(socketB.url).toContain("token=token_tenant_b");
      expect(socketB.url).toContain("organization_id=org_tenant_b");

      sync.disconnect();
    });
  });
});
