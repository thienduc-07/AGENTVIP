import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncManager } from "@/lib/websocket/syncManager";
import { EventEnvelope, WsSnapshotMessage } from "@/types/events";
import { StateBridge } from "@/lib/stateBridge";
import { useWorldStore } from "@/store/worldStore";
import { useSceneStore } from "@/store/sceneStore";
import { mapWorkstationsToScene } from "@/lib/spatial/workstationMapper";
import { ZoneConfig, WorkstationAllocation } from "@/lib/api/workstations";

describe("Phase 3.2.5 Audit Remediation Verification", () => {
  describe("FINDING-325-01: Real-Time Event Sync Ordering & Watermark", () => {
    it("should process valid out-of-order events without dropping them as duplicates", () => {
      const sync = new SyncManager({ autoConnect: false });
      const receivedEvents: EventEnvelope[] = [];
      sync.onEvent((ev) => receivedEvents.push(ev));

      // 1. Authoritative snapshot hydrated at sequence 100
      const snapshot: WsSnapshotMessage = {
        message_type: "snapshot",
        snapshot_id: "snap_100",
        generated_at: new Date().toISOString(),
        last_sequence_id: 100,
        data: { agents: [], active_tasks: [] },
      };
      sync.handleIncomingRawMessage(snapshot);
      expect(sync.getTelemetry().snapshotWatermark).toBe(100);
      expect(sync.getLastSequenceId()).toBe(100);

      // 2. Live event A arrives with sequence 105
      const eventA: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_105",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 105,
        agent_id: "agent_1",
        task_id: "task_1",
        payload: { title: "Task 105" },
      };
      const resultA = sync.ingestValidatedEvent(eventA);
      expect(resultA).toBe(true);
      expect(sync.getLastSequenceId()).toBe(105);

      // 3. Live event B arrives with sequence 103 (out of order, but unseen and > snapshotWatermark)
      const eventB: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_103",
        event_type: "task.status_changed",
        occurred_at: new Date().toISOString(),
        sequence_id: 103,
        agent_id: "agent_1",
        task_id: "task_1",
        payload: { status: "running" },
      };
      const resultB = sync.ingestValidatedEvent(eventB);
      // Event B MUST NOT be discarded!
      expect(resultB).toBe(true);
      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents[1].event_id).toBe("evt_103");
      expect(sync.getTelemetry().duplicateEventsSuppressed).toBe(0);

      // 4. Stale event arriving with sequence <= snapshotWatermark is safely suppressed
      const staleEvent: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_stale_95",
        event_type: "task.created",
        occurred_at: new Date().toISOString(),
        sequence_id: 95,
        agent_id: "agent_1",
        task_id: "task_old",
        payload: {},
      };
      const resultStale = sync.ingestValidatedEvent(staleEvent);
      expect(resultStale).toBe(false);
      expect(sync.getTelemetry().duplicateEventsSuppressed).toBe(1);
    });

    it("should suppress genuine duplicates using event_id deduplication", () => {
      const sync = new SyncManager({ autoConnect: false });
      let callCount = 0;
      sync.onEvent(() => callCount++);

      const event: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_dup_check",
        event_type: "agent.status_updated",
        occurred_at: new Date().toISOString(),
        sequence_id: 200,
        agent_id: "agent_1",
        task_id: null,
        payload: {},
      };

      expect(sync.ingestValidatedEvent(event)).toBe(true);
      expect(sync.ingestValidatedEvent(event)).toBe(false); // Second ingestion suppressed
      expect(callCount).toBe(1);
      expect(sync.getTelemetry().duplicateEventsSuppressed).toBe(1);
    });
  });

  describe("FINDING-325-05: StateBridge Reference Memoization & Rerender Guard", () => {
    beforeEach(() => {
      useSceneStore.setState({ agentVisuals: {}, workstationTransforms: {} });
    });

    it("should NOT trigger sceneStore projection when worldStore updates unrelated fields", () => {
      const bridge = StateBridge.getInstance();
      const stop = bridge.start();

      const setBatchSpy = vi.spyOn(useSceneStore.getState(), "setBatchAgentVisuals");

      // Initial state is projected on start
      expect(bridge.isActive()).toBe(true);

      // Reset spy after initial projection
      setBatchSpy.mockClear();

      // Trigger unrelated worldStore mutation (e.g. chat message)
      useWorldStore.getState().addChatMessage({
        id: "msg_memo_test",
        sender: "user",
        text: "Testing memoization",
        timestamp: Date.now(),
      });

      // StateBridge must detect that agents and activeTasks references did NOT change
      // and skip calling setBatchAgentVisuals!
      expect(setBatchSpy).not.toHaveBeenCalled();

      stop();
    });
  });

  describe("FINDING-325-02 & D3 Invariants: Workstation Telemetry Mathematics", () => {
    const mockZones: ZoneConfig[] = [
      {
        department: "Engineering",
        zone: "engineering_bay",
        base_x: -14.0,
        base_y: 1.0,
        base_z: -4.0,
        max_physical_desks: 12,
        desk_spacing_x: 2.2,
        desk_spacing_z: 2.0,
        allocated_count: 1,
        physical_occupied_count: 1,
        reserved_unoccupied_count: 0,
        available_physical_count: 11,
        virtual_count: 1,
      },
      {
        department: "Operations",
        zone: "operations_hub",
        base_x: -6.0,
        base_y: 1.0,
        base_z: 20.0,
        max_physical_desks: 6,
        desk_spacing_x: 2.2,
        desk_spacing_z: 2.0,
        allocated_count: 1,
        physical_occupied_count: 0,
        reserved_unoccupied_count: 1,
        available_physical_count: 5,
        virtual_count: 0,
      },
    ];

    const mockAllocations: WorkstationAllocation[] = [
      // 1. Engineering: Physical, Working (Occupied)
      {
        id: "alloc_1",
        organization_id: "org_alpha",
        agent_id: "agent_eng_1",
        department: "Engineering",
        logical_workstation_id: "engineering_bay_desk_1",
        office_zone: "engineering_bay",
        desk_number: 1,
        pos_x: -15.1,
        pos_y: 1.0,
        pos_z: -4.0,
        allocation_status: "ASSIGNED",
        is_virtual: false,
        agent_status: "working",
      },
      // 2. Engineering: Virtual Workforce
      {
        id: "alloc_2",
        organization_id: "org_alpha",
        agent_id: "agent_eng_cloud",
        department: "Engineering",
        logical_workstation_id: "virtual_desk_1",
        office_zone: "engineering_bay",
        desk_number: null,
        pos_x: 0,
        pos_y: 0,
        pos_z: 0,
        allocation_status: "VIRTUAL",
        is_virtual: true,
        agent_status: "working",
      },
      // 3. Operations: Physical, Offline (Reserved but Unoccupied)
      {
        id: "alloc_3",
        organization_id: "org_alpha",
        agent_id: "agent_ops_1",
        department: "Operations",
        logical_workstation_id: "operations_hub_desk_1",
        office_zone: "operations_hub",
        desk_number: 1,
        pos_x: -7.1,
        pos_y: 1.0,
        pos_z: 20.0,
        allocation_status: "ASSIGNED",
        is_virtual: false,
        agent_status: "offline",
      },
    ];

    it("should satisfy all D3 mathematical invariants across physical desks and virtual workforce", () => {
      const result = mapWorkstationsToScene(mockZones, mockAllocations);

      const t = result.telemetry;
      const totalPhysicalCapacity = 18; // 12 + 6

      // Total physical capacity
      expect(t.total_desk_capacity).toBe(totalPhysicalCapacity);

      // Exactly 2 physical desks allocated (1 in Eng, 1 in Ops)
      expect(t.total_allocated).toBe(2);

      // Exactly 1 physical desk occupied (Eng is working)
      expect(t.total_physical_occupied).toBe(1);

      // Exactly 1 physical desk reserved but unoccupied (Ops is offline)
      expect(t.total_reserved_unoccupied).toBe(1);

      // Exactly 16 physical desks unallocated (18 - 2 = 16)
      expect(t.total_physical_available).toBe(16);

      // Exactly 1 virtual workforce worker (does NOT inflate physical allocated)
      expect(t.total_virtual_workforce).toBe(1);

      // INVARIANT 1: Capacity = Allocated + Available
      expect(t.total_allocated + t.total_physical_available).toBe(t.total_desk_capacity);

      // INVARIANT 2: Allocated = Occupied + ReservedUnoccupied
      expect(t.total_physical_occupied + (t.total_reserved_unoccupied ?? 0)).toBe(t.total_allocated);

      // INVARIANT 3: 0 <= Occupied <= Allocated <= Capacity
      expect(t.total_physical_occupied).toBeLessThanOrEqual(t.total_allocated);
      expect(t.total_allocated).toBeLessThanOrEqual(t.total_desk_capacity);
    });
  });
});
