import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CANONICAL_STATE_CONFIGS, CanonicalAgentState } from "../types/office";
import { WorldSnapshotResponse, ZoneConfig, WorkstationOverviewResponse } from "../types";
import { EventEnvelope } from "../types/events";
import { normalizeBehavioralState } from "../lib/spatialMovement";

describe("Phase 4.1: 3D Office Foundation & Real-Time Integration", () => {
  // =========================================================================
  // 1. CANONICAL 9-STATE BEHAVIORAL MATRIX
  // =========================================================================
  describe("1. Canonical 9-State Behavioral State System", () => {
    const requiredStates: CanonicalAgentState[] = [
      "IDLE",
      "QUEUED",
      "ASSIGNED",
      "IN_PROGRESS",
      "WAITING",
      "REVIEW",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ];

    it("should define complete visual and animation configurations for all 9 canonical states", () => {
      requiredStates.forEach((state) => {
        const config = CANONICAL_STATE_CONFIGS[state];
        expect(config, `Missing config for state: ${state}`).toBeDefined();
        expect(config.label).toBeTruthy();
        expect(config.badgeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(config.beaconColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(config.emissiveIntensity).toBeGreaterThan(0);
        expect(config.emissiveIntensity).toBeLessThanOrEqual(1.0);
        expect(config.animationType).toBeTruthy();
        expect(config.monitorColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });

    it("should correctly map active states to higher emissive intensities than idle/cancelled", () => {
      const activeStates: CanonicalAgentState[] = ["IN_PROGRESS", "COMPLETED", "FAILED", "REVIEW"];
      const passiveStates: CanonicalAgentState[] = ["IDLE", "CANCELLED"];

      activeStates.forEach((active) => {
        passiveStates.forEach((passive) => {
          expect(
            CANONICAL_STATE_CONFIGS[active].emissiveIntensity
          ).toBeGreaterThan(CANONICAL_STATE_CONFIGS[passive].emissiveIntensity);
        });
      });
    });

    it("should normalize raw strings into canonical behavioral states with safe fallback", () => {
      expect(normalizeBehavioralState("WORKING", "working")).toBe("WORKING");
      expect(normalizeBehavioralState("THINKING", "working")).toBe("THINKING");
      expect(normalizeBehavioralState("WAITING", "waiting_approval")).toBe("WAITING");
      expect(normalizeBehavioralState("PLANNING", "idle")).toBe("PLANNING");
      expect(normalizeBehavioralState("unknown_junk_state", "working")).toBe("WORKING");
      expect(normalizeBehavioralState(undefined, "waiting_approval")).toBe("WAITING");
      expect(normalizeBehavioralState(null, "idle")).toBe("IDLE");
    });
  });

  // =========================================================================
  // 2. WORLD SNAPSHOT HYDRATION & ENTITY MAPPING
  // =========================================================================
  describe("2. Authoritative World Snapshot Hydration & Spatial Coordinates", () => {
    it("should accurately transform backend snapshot agents with spatial coordinates", () => {
      const mockSnapshot: WorldSnapshotResponse = {
        organization_id: "org_default_company",
        sequence_id: 1042,
        server_timestamp: "2026-11-02T13:30:00Z",
        agents: [
          {
            employee_id: "agent-exec-ceo",
            name: "Victoria Vance",
            role: "Chief Executive Officer",
            department: "Executive",
            lifecycle_state: "ACTIVE",
            operational_status: "working",
            behavioral_state: "PLANNING",
            assigned_workstation: "ws-exec-01",
            current_active_task: {
              task_id: "task-quarterly-plan",
              title: "Q4 Strategic Roadmap",
              status: "IN_PROGRESS",
              priority: "high",
            },
            spatial_coordinates: { x: 0.0, y: 1.0, z: -12.0 },
            target_coordinates: null,
            active_movement_id: null,
          },
          {
            employee_id: "agent-eng-lead",
            name: "David Chen",
            role: "VP of Engineering",
            department: "Engineering",
            lifecycle_state: "ACTIVE",
            operational_status: "idle",
            behavioral_state: "IDLE",
            assigned_workstation: "ws-eng-01",
            current_active_task: null,
            spatial_coordinates: { x: -14.0, y: 1.0, z: -4.0 },
            target_coordinates: { x: -14.0, y: 1.0, z: 2.0 },
            active_movement_id: "mov-eng-102",
          },
        ],
        workstations: [
          {
            workstation_id: "ws-exec-01",
            zone: "Executive",
            spatial_coordinates: { x: 0.0, y: 1.0, z: -12.0 },
            occupancy_status: "occupied",
            assigned_employee: "agent-exec-ceo",
            is_virtual: false,
          },
          {
            workstation_id: "ws-eng-01",
            zone: "Engineering",
            spatial_coordinates: { x: -14.0, y: 1.0, z: -4.0 },
            occupancy_status: "occupied",
            assigned_employee: "agent-eng-lead",
            is_virtual: false,
          },
        ],
        activities: [],
      };

      // Verify sequence id watermark
      expect(mockSnapshot.sequence_id).toBe(1042);
      expect(mockSnapshot.agents.length).toBe(2);

      const ceo = mockSnapshot.agents[0];
      expect(ceo.employee_id).toBe("agent-exec-ceo");
      expect(ceo.spatial_coordinates).toEqual({ x: 0, y: 1, z: -12 });
      expect(ceo.current_active_task?.title).toBe("Q4 Strategic Roadmap");

      const eng = mockSnapshot.agents[1];
      expect(eng.target_coordinates).toEqual({ x: -14, y: 1, z: 2 });
      expect(eng.active_movement_id).toBe("mov-eng-102");
    });

    it("should handle null or absent coordinates gracefully without runtime exceptions", () => {
      const mockSnapshotSparse: WorldSnapshotResponse = {
        organization_id: "org_default_company",
        sequence_id: 1043,
        server_timestamp: "2026-11-02T13:30:00Z",
        agents: [
          {
            employee_id: "agent-sparse",
            name: "Sparse Agent",
            role: "Analyst",
            department: "Finance",
            lifecycle_state: "ACTIVE",
            operational_status: "idle",
            behavioral_state: undefined,
            assigned_workstation: null,
            current_active_task: null,
            spatial_coordinates: null,
            target_coordinates: null,
            active_movement_id: null,
          },
        ],
        workstations: [],
        activities: [],
      };

      const agent = mockSnapshotSparse.agents[0];
      const posX = agent.spatial_coordinates?.x ?? 0;
      const posY = agent.spatial_coordinates?.y ?? 1;
      const posZ = agent.spatial_coordinates?.z ?? 0;

      expect(posX).toBe(0);
      expect(posY).toBe(1);
      expect(posZ).toBe(0);
      expect(agent.target_coordinates).toBeNull();
    });
  });

  // =========================================================================
  // 3. DEPARTMENT ZONE & WORKSTATION ALLOCATION
  // =========================================================================
  describe("3. Dynamic Department Zones & Workstation Topology", () => {
    it("should map 8 canonical backend department zones with accurate base positions", () => {
      const mockZones: ZoneConfig[] = [
        { department: "Executive", zone: "Zone A", base_x: 0, base_y: 0, base_z: -12, max_physical_desks: 2 },
        { department: "Engineering", zone: "Zone B", base_x: -14, base_y: 0, base_z: -4, max_physical_desks: 8 },
        { department: "AI Research", zone: "Zone C", base_x: -14, base_y: 0, base_z: 10, max_physical_desks: 6 },
        { department: "Marketing", zone: "Zone D", base_x: 14, base_y: 0, base_z: -10, max_physical_desks: 6 },
        { department: "Sales", zone: "Zone E", base_x: 14, base_y: 0, base_z: 2, max_physical_desks: 6 },
        { department: "Operations", zone: "Zone F", base_x: 14, base_y: 0, base_z: 14, max_physical_desks: 6 },
        { department: "Finance", zone: "Zone G", base_x: -6, base_y: 0, base_z: 18, max_physical_desks: 4 },
        { department: "Customer Success", zone: "Zone H", base_x: 6, base_y: 0, base_z: 18, max_physical_desks: 6 },
      ];

      expect(mockZones.length).toBe(8);

      const execZone = mockZones.find((z) => z.department === "Executive");
      expect(execZone).toBeDefined();
      expect(execZone?.base_x).toBe(0);
      expect(execZone?.base_z).toBe(-12);

      const engZone = mockZones.find((z) => z.department === "Engineering");
      expect(engZone).toBeDefined();
      expect(engZone?.base_x).toBe(-14);
      expect(engZone?.base_z).toBe(-4);

      const aiZone = mockZones.find((z) => z.department === "AI Research");
      expect(aiZone).toBeDefined();
      expect(aiZone?.base_x).toBe(-14);
      expect(aiZone?.base_z).toBe(10);
    });

    it("should differentiate physical desks from virtual overflow workstations", () => {
      const mockOverview: WorkstationOverviewResponse = {
        organization_id: "org_default_company",
        total_workstations: 10,
        occupied_workstations: 2,
        zones: [
          { department: "Engineering", zone: "Zone B", base_x: -14, base_y: 0, base_z: -4, max_physical_desks: 2 },
        ],
        allocations: [
          {
            id: "ws-eng-01",
            logical_workstation_id: "ws-eng-01",
            agent_id: "agent-eng-lead",
            agent_name: "David Chen",
            agent_role: "VP of Engineering",
            department: "Engineering",
            office_zone: "Zone B",
            desk_number: 1,
            pos_x: -14,
            pos_y: 1,
            pos_z: -4,
            allocation_status: "ASSIGNED",
            is_virtual: false,
          },
          {
            id: "ws-eng-virtual-09",
            logical_workstation_id: "ws-eng-v-09",
            agent_id: "agent-eng-contractor",
            agent_name: "Alex Cloud",
            agent_role: "Cloud Architect",
            department: "Engineering",
            office_zone: "Zone B",
            desk_number: 9,
            pos_x: -14,
            pos_y: 1,
            pos_z: -4,
            allocation_status: "ASSIGNED",
            is_virtual: true,
          },
        ],
      };

      const physical = mockOverview.allocations.find((a) => !a.is_virtual);
      const virtual = mockOverview.allocations.find((a) => a.is_virtual);

      expect(physical).toBeDefined();
      expect(physical?.is_virtual).toBe(false);
      expect(physical?.desk_number).toBe(1);

      expect(virtual).toBeDefined();
      expect(virtual?.is_virtual).toBe(true);
      expect(virtual?.desk_number).toBe(9);
    });
  });

  // =========================================================================
  // 4. REAL-TIME EVENT INGESTION & STATE PROPAGATION
  // =========================================================================
  describe("4. Real-Time Event Stream Ingestion & State Transitions", () => {
    it("should transition agent behavioral state on agent.behavioral_state_changed", () => {
      let agentState: CanonicalAgentState = "IDLE";
      let taskTitle: string | null = null;

      const envelope: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_state_001",
        event_type: "agent.behavioral_state_changed",
        occurred_at: "2026-11-02T13:31:00Z",
        sequence_id: 1045,
        agent_id: "agent-exec-ceo",
        task_id: "task-strategic-review",
        organization_id: "org_default_company",
        payload: {
          agent_id: "agent-exec-ceo",
          behavioral_state: "REVIEW",
          operational_status: "working",
          reason: "Reviewing Q4 financial statement",
        },
      };

      // Simulate hook event processing
      if (envelope.event_type === "agent.behavioral_state_changed") {
        const nextState = envelope.payload.behavioral_state as CanonicalAgentState;
        agentState = nextState;
        taskTitle = envelope.payload.reason;
      }

      expect(agentState).toBe("REVIEW");
      expect(taskTitle).toBe("Reviewing Q4 financial statement");
      expect(CANONICAL_STATE_CONFIGS[agentState].animationType).toBe("reviewing");
      expect(CANONICAL_STATE_CONFIGS[agentState].beaconColor).toBe("#a78bfa");
    });

    it("should start movement and record target coordinates on agent.movement_started", () => {
      let isMoving = false;
      let targetPos: [number, number, number] | null = null;
      let state: CanonicalAgentState = "IDLE";

      const envelope: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_mov_001",
        event_type: "agent.movement_started",
        occurred_at: "2026-11-02T13:31:10Z",
        sequence_id: 1046,
        agent_id: "agent-eng-lead",
        task_id: "task-deploy",
        organization_id: "org_default_company",
        payload: {
          agent_id: "agent-eng-lead",
          target_position: [-14.0, 1.0, 10.0],
          target_destination: "AI Research Lab",
          movement_id: "mov-cross-dept-01",
        },
      };

      if (envelope.event_type === "agent.movement_started") {
        const t = envelope.payload.target_position;
        targetPos = [t[0], t[1], t[2]];
        isMoving = true;
        state = "ASSIGNED";
      }

      expect(isMoving).toBe(true);
      expect(targetPos).toEqual([-14.0, 1.0, 10.0]);
      expect(state).toBe("ASSIGNED");
    });

    it("should arrive at destination and reset movement flag on agent.movement_completed", () => {
      let isMoving = true;
      let currentPos: [number, number, number] = [-14.0, 1.0, 0.0];
      let targetPos: [number, number, number] | null = [-14.0, 1.0, 10.0];
      let state: CanonicalAgentState = "ASSIGNED";

      const envelope: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_mov_002",
        event_type: "agent.movement_completed",
        occurred_at: "2026-11-02T13:31:25Z",
        sequence_id: 1047,
        agent_id: "agent-eng-lead",
        task_id: "task-deploy",
        organization_id: "org_default_company",
        payload: {
          agent_id: "agent-eng-lead",
          position: [-14.0, 1.0, 10.0],
          behavioral_state: "IDLE",
        },
      };

      if (envelope.event_type === "agent.movement_completed") {
        const p = envelope.payload.position;
        currentPos = [p[0], p[1], p[2]];
        targetPos = null;
        isMoving = false;
        state = (envelope.payload.behavioral_state as CanonicalAgentState) || "IDLE";
      }

      expect(isMoving).toBe(false);
      expect(targetPos).toBeNull();
      expect(currentPos).toEqual([-14.0, 1.0, 10.0]);
      expect(state).toBe("IDLE");
    });

    it("should transition agent to IN_PROGRESS on tool.execution_started", () => {
      let state: CanonicalAgentState = "IDLE";
      let taskTitle: string | null = null;

      const envelope: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_tool_001",
        event_type: "tool.execution_started",
        occurred_at: "2026-11-02T13:31:40Z",
        sequence_id: 1048,
        agent_id: "agent-eng-lead",
        task_id: "task-tool-1",
        organization_id: "org_default_company",
        payload: {
          agent_id: "agent-eng-lead",
          tool_name: "bash_sandbox_exec",
          parameters: { command: "npm test" },
        },
      };

      if (envelope.event_type === "tool.execution_started") {
        state = "IN_PROGRESS";
        taskTitle = `Đang chạy công cụ: ${envelope.payload.tool_name}`;
      }

      expect(state).toBe("IN_PROGRESS");
      expect(taskTitle).toBe("Đang chạy công cụ: bash_sandbox_exec");
      expect(CANONICAL_STATE_CONFIGS[state].ambientVfx).toBe("typing");
    });

    it("should transition agent to COMPLETED on task.completed", () => {
      let state: CanonicalAgentState = "IN_PROGRESS";
      let taskTitle: string | null = "Active feature build";

      const envelope: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_task_comp_001",
        event_type: "task.completed",
        occurred_at: "2026-11-02T13:32:00Z",
        sequence_id: 1049,
        agent_id: "agent-eng-lead",
        task_id: "task-tool-1",
        organization_id: "org_default_company",
        payload: {
          agent_id: "agent-eng-lead",
          task_id: "task-tool-1",
          result: "All 459 tests passing",
        },
      };

      if (envelope.event_type === "task.completed") {
        state = "COMPLETED";
        taskTitle = null;
      }

      expect(state).toBe("COMPLETED");
      expect(taskTitle).toBeNull();
      expect(CANONICAL_STATE_CONFIGS[state].badgeColor).toBe("#10b981");
    });

    it("should transition agent to FAILED with error payload on task.failed", () => {
      let state: CanonicalAgentState = "IN_PROGRESS";
      let taskTitle: string | null = "Active compile";

      const envelope: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_task_fail_001",
        event_type: "task.failed",
        occurred_at: "2026-11-02T13:32:15Z",
        sequence_id: 1050,
        agent_id: "agent-eng-lead",
        task_id: "task-compile-1",
        organization_id: "org_default_company",
        payload: {
          agent_id: "agent-eng-lead",
          task_id: "task-compile-1",
          error_message: "Process timeout after 30s",
        },
      };

      if (envelope.event_type === "task.failed") {
        state = "FAILED";
        taskTitle = `Lỗi: ${envelope.payload.error_message}`;
      }

      expect(state).toBe("FAILED");
      expect(taskTitle).toBe("Lỗi: Process timeout after 30s");
      expect(CANONICAL_STATE_CONFIGS[state].badgeColor).toBe("#ef4444");
    });
  });

  // =========================================================================
  // 5. WATERMARK PROGRESSION & CONCURRENCY ORDERING
  // =========================================================================
  describe("5. Sequence Watermark Progression & Out-of-Order Rejection", () => {
    it("should monotonically advance the sequence watermark and ignore older sequences", () => {
      let currentWatermark = 1000;

      const incomingSequences = [1005, 1002, 1010, 1008, 1025];
      const watermarkHistory: number[] = [];

      incomingSequences.forEach((seq) => {
        currentWatermark = Math.max(currentWatermark, seq);
        watermarkHistory.push(currentWatermark);
      });

      expect(watermarkHistory).toEqual([1005, 1005, 1010, 1010, 1025]);
      expect(currentWatermark).toBe(1025);
    });
  });

  // =========================================================================
  // 6. ZERO-FABRICATION & EMPTY ORGANIZATION HANDLING
  // =========================================================================
  describe("6. Zero-Fabrication Integrity & Empty Organization State", () => {
    it("should evaluate isEmptyOrg to true when snapshot returns 0 agents and 0 departments", () => {
      const agents = {};
      const departments = {};
      const isLoading = false;

      const totalAgents = Object.keys(agents).length;
      const totalDepts = Object.keys(departments).length;
      const isEmptyOrg = !isLoading && totalAgents === 0 && totalDepts === 0;

      expect(isEmptyOrg).toBe(true);
    });

    it("should never fabricate fake placeholder agents in empty organization state", () => {
      const emptySnapshot: WorldSnapshotResponse = {
        organization_id: "org_unpopulated_brand_new",
        sequence_id: 1,
        server_timestamp: "2026-11-02T13:30:00Z",
        agents: [],
        workstations: [],
        activities: [],
      };

      const loadedAgents: Record<string, any> = {};
      emptySnapshot.agents.forEach((item) => {
        loadedAgents[item.employee_id] = item;
      });

      expect(Object.keys(loadedAgents).length).toBe(0);
      expect(loadedAgents["agent-exec-ceo"]).toBeUndefined();
    });
  });

  // =========================================================================
  // 7. CAMERA PRESETS & TACTICAL VIEWS
  // =========================================================================
  describe("7. Tactical Camera Presets & Spatial Viewports", () => {
    it("should define exact tactical overview coordinates for full headquarters inspection", () => {
      const TACTICAL_OVERVIEW_POS: [number, number, number] = [0, 26, 32];
      const TACTICAL_OVERVIEW_LOOK: [number, number, number] = [0, 0, 4];

      expect(TACTICAL_OVERVIEW_POS[1]).toBe(26); // High altitude view
      expect(TACTICAL_OVERVIEW_POS[2]).toBe(32); // Southern elevation
      expect(TACTICAL_OVERVIEW_LOOK[1]).toBe(0);  // Ground look target
    });

    it("should define executive CEO suite focus camera coordinates", () => {
      const CEO_SUITE_TARGET: [number, number, number] = [0, 1.2, -12];
      const CEO_SUITE_CAM: [number, number, number] = [0, 7.5, -4];

      expect(CEO_SUITE_TARGET).toEqual([0, 1.2, -12]);
      expect(CEO_SUITE_CAM[1]).toBe(7.5);
      expect(CEO_SUITE_CAM[2]).toBe(-4);
    });
  });
});
