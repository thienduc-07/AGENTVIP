import { describe, it, expect, beforeEach, vi } from "vitest";
import { SyncManager } from "../lib/websocket/syncManager";
import { useWorldStore } from "../store/worldStore";
import { EventEnvelope } from "../types/events";

describe("Phase 3.3.2: Real-time World Synchronization & Event Persistence", () => {
  let syncMgr: SyncManager;

  beforeEach(() => {
    syncMgr = new SyncManager({
      autoConnect: false,
      token: "test.jwt.token",
      organizationId: "org_default_company",
    });

    // Reset worldStore state between tests
    useWorldStore.setState({
      lastSequenceId: 0,
      processedEventIds: [],
      recentEvents: [],
      activeTasks: {},
      worldSnapshot: null,
      isLoadingSnapshot: false,
      snapshotError: null,
    });
  });

  describe("A. Event Sequence & Deduplication Guarantees", () => {
    it("should accept strictly newer sequence IDs and progress cursor monotonically", () => {
      const event1: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_seq_1",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 10,
        agent_id: "agent-exec-ceo",
        task_id: "task-1",
        organization_id: "org_default_company",
        payload: { task: { id: "task-1", title: "Task 1", status: "queued" } },
      };

      const applied1 = syncMgr.ingestValidatedEvent(event1);
      expect(applied1).toBe(true);
      expect(syncMgr.getLastSequenceId()).toBe(10);

      const event2: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_seq_2",
        event_type: "task.started",
        occurred_at: new Date().toISOString(),
        sequence_id: 12, // Non-consecutive gap (10 -> 12)
        agent_id: "agent-exec-ceo",
        task_id: "task-1",
        organization_id: "org_default_company",
        payload: { task_title: "Task 1 running" },
      };

      const applied2 = syncMgr.ingestValidatedEvent(event2);
      expect(applied2).toBe(true);
      expect(syncMgr.getLastSequenceId()).toBe(12);
    });

    it("should suppress duplicate events with identical event_id", () => {
      const event: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_dup_check",
        event_type: "agent.status_changed",
        occurred_at: new Date().toISOString(),
        sequence_id: 15,
        agent_id: "agent-exec-ceo",
        task_id: null,
        organization_id: "org_default_company",
        payload: {},
      };

      const firstPass = syncMgr.ingestValidatedEvent(event);
      expect(firstPass).toBe(true);

      const secondPass = syncMgr.ingestValidatedEvent(event);
      expect(secondPass).toBe(false);
      expect(syncMgr.getTelemetry().duplicateEventsSuppressed).toBe(1);
    });

    it("should reject events with sequence_id <= snapshotWatermark", () => {
      syncMgr.setSnapshotWatermark(100);

      const staleEvent: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_stale_watermark",
        event_type: "task.completed",
        occurred_at: new Date().toISOString(),
        sequence_id: 95, // Below watermark 100
        agent_id: "agent-exec-ceo",
        task_id: "task-old",
        organization_id: "org_default_company",
        payload: {},
      };

      const applied = syncMgr.ingestValidatedEvent(staleEvent);
      expect(applied).toBe(false);
      expect(syncMgr.getTelemetry().duplicateEventsSuppressed).toBe(1);
    });

    it("should safely accept multi-tenant global sequence gaps without false replay alarms", () => {
      const eventA: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_gap_1",
        event_type: "agent.activated",
        occurred_at: new Date().toISOString(),
        sequence_id: 50,
        agent_id: "agent-exec-ceo",
        task_id: null,
        organization_id: "org_default_company",
        payload: {},
      };

      // Gap of 25 due to other tenant traffic
      const eventB: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_gap_2",
        event_type: "agent.suspended",
        occurred_at: new Date().toISOString(),
        sequence_id: 75,
        agent_id: "agent-exec-ceo",
        task_id: null,
        organization_id: "org_default_company",
        payload: {},
      };

      expect(syncMgr.ingestValidatedEvent(eventA)).toBe(true);
      expect(syncMgr.ingestValidatedEvent(eventB)).toBe(true);
      expect(syncMgr.getLastSequenceId()).toBe(75);
    });
  });

  describe("B. Tenant Isolation on Organization Switch", () => {
    it("should reset watermark, sequence cursor, and processed event IDs when switching tenants", () => {
      syncMgr.ingestValidatedEvent({
        schema_version: 1,
        event_id: "evt_tenant_old",
        event_type: "agent.activated",
        occurred_at: new Date().toISOString(),
        sequence_id: 88,
        agent_id: "agent-exec-ceo",
        task_id: null,
        organization_id: "org_default_company",
        payload: {},
      });

      expect(syncMgr.getLastSequenceId()).toBe(88);

      // Switch to new organization
      syncMgr.switchTenant("new.jwt.token", "org_new_startup");

      expect(syncMgr.getLastSequenceId()).toBe(0);
      expect(syncMgr.getTelemetry().snapshotWatermark).toBe(0);
      expect(syncMgr.getTelemetry().processedEventsCount).toBe(1); // Lifetime telemetry count preserved
    });
  });

  describe("C. WorldStore Event Ingestion & State Reconciliation", () => {
    it("should dynamically add recruited specialist on agent.recruited event", () => {
      const recruitedEvent: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_recruited_test",
        event_type: "agent.recruited",
        occurred_at: new Date().toISOString(),
        sequence_id: 110,
        agent_id: "agent-spec-ml-auditor",
        task_id: null,
        organization_id: "org_default_company",
        payload: {
          agent_id: "agent-spec-ml-auditor",
          name: "Dr. Evelyn Reed (ML Specialist)",
          role: "ML Integrity Auditor",
          department: "AI Research",
          station: "research_lab",
          position: [14.0, 1.0, -4.0],
          color: "#06b6d4",
          specialist_slug: "ml-auditor",
        },
      };

      useWorldStore.getState().applyEvent(recruitedEvent);

      const agent = useWorldStore.getState().agents["agent-spec-ml-auditor"];
      expect(agent).toBeDefined();
      expect(agent.name).toBe("Dr. Evelyn Reed (ML Specialist)");
      expect(agent.role).toBe("ML Integrity Auditor");
      expect(agent.status).toBe("idle");
      expect(agent.position).toEqual([14.0, 1.0, -4.0]);
    });

    it("should update agent operational status on lifecycle change events", () => {
      const ceoId = "agent-exec-ceo";

      // 1. Suspend CEO
      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_suspend_ceo",
        event_type: "agent.suspended",
        occurred_at: new Date().toISOString(),
        sequence_id: 120,
        agent_id: ceoId,
        task_id: null,
        organization_id: "org_default_company",
        payload: { agent_id: ceoId },
      });

      expect(useWorldStore.getState().agents[ceoId].status).toBe("offline");

      // 2. Reactivate CEO
      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_activate_ceo",
        event_type: "agent.activated",
        occurred_at: new Date().toISOString(),
        sequence_id: 121,
        agent_id: ceoId,
        task_id: null,
        organization_id: "org_default_company",
        payload: { agent_id: ceoId },
      });

      expect(useWorldStore.getState().agents[ceoId].status).toBe("idle");
    });

    it("should update agent spatial workstation coordinates on workstation.allocated event", () => {
      const ctoId = "agent-eng-lead";

      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_ws_cto",
        event_type: "workstation.allocated",
        occurred_at: new Date().toISOString(),
        sequence_id: 130,
        agent_id: ctoId,
        task_id: null,
        organization_id: "org_default_company",
        payload: {
          agent_id: ctoId,
          department: "Engineering",
          office_zone: "engineering_bay",
          desk_number: 3,
          position: [-14.0, 1.0, 2.0],
        },
      });

      const cto = useWorldStore.getState().agents[ctoId];
      expect(cto).toBeDefined();
      expect(cto.station).toBe("engineering_bay");
      expect(cto.position).toEqual([-14.0, 1.0, 2.0]);
    });

    it("should track task lifecycle transitions from created to completed", () => {
      const agentId = "agent-ops-recruiter";
      const taskId = "task_sync_lifecycle_1";

      // Created
      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_task_create",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 140,
        agent_id: agentId,
        task_id: taskId,
        organization_id: "org_default_company",
        payload: {
          id: taskId,
          title: "Quarterly Audit Sync",
          priority: "high",
          status: "queued",
        },
      });

      expect(useWorldStore.getState().activeTasks[taskId]).toBeDefined();

      // Assigned
      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_task_assign",
        event_type: "task.assigned",
        occurred_at: new Date().toISOString(),
        sequence_id: 141,
        agent_id: agentId,
        task_id: taskId,
        organization_id: "org_default_company",
        payload: {
          task_id: taskId,
          task_title: "Quarterly Audit Sync",
        },
      });

      expect(useWorldStore.getState().agents[agentId].status).toBe("working");
      expect(useWorldStore.getState().agents[agentId].currentTask).toBe("Quarterly Audit Sync");

      // Completed
      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_task_complete",
        event_type: "task.completed",
        occurred_at: new Date().toISOString(),
        sequence_id: 142,
        agent_id: agentId,
        task_id: taskId,
        organization_id: "org_default_company",
        payload: {},
      });

      expect(useWorldStore.getState().activeTasks[taskId]).toBeUndefined();
      expect(useWorldStore.getState().agents[agentId].status).toBe("idle");
      expect(useWorldStore.getState().agents[agentId].currentTask).toBeNull();
    });

    it("should prevent older snapshot from overwriting newer real-time state", async () => {
      // Current sequence progressed to 200 via real-time stream
      useWorldStore.setState({ lastSequenceId: 200 });

      // Mock an older snapshot arriving late with sequence_id: 150
      const fakeApiWorld = await import("../lib/api/world");
      vi.spyOn(fakeApiWorld, "getWorldSnapshot").mockResolvedValueOnce({
        organization_id: "org_default_company",
        timestamp: new Date().toISOString(),
        sequence_id: 150, // Stale!
        employees: [],
        workstations: [],
        workforce_summary: {
          total_employees: 0,
          active_workers: 0,
          idle_workers: 0,
          offline_workers: 0,
          suspended_workers: 0,
          by_department: {},
        },
        company_metrics: {
          total_tasks_count: 0,
          completed_tasks_count: 0,
          failed_tasks_count: 0,
          active_tasks_count: 0,
        },
      } as any);

      const res = await useWorldStore.getState().fetchWorldSnapshot();

      // Sequence cursor must NOT regress to 150
      expect(useWorldStore.getState().lastSequenceId).toBe(200);
    });
  });
});
