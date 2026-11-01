import { describe, it, expect, beforeEach } from "vitest";
import { useWorldStore } from "../store/worldStore";
import {
  computeHeadingRadians,
  lerpAngleRadians,
  stepAgentMovement,
  reconcileAgentPositionOnSnapshot,
  distance3D,
} from "../lib/spatialMovement";
import { EventEnvelope } from "../types/events";

describe("Phase 3.3.3: Autonomous Agent Behavior & Hybrid Spatial Integration", () => {
  beforeEach(() => {
    useWorldStore.setState({
      lastSequenceId: 0,
      processedEventIds: [],
      recentEvents: [],
      activeTasks: {},
      agents: {
        "agent-exec-ceo": {
          id: "agent-exec-ceo",
          name: "Victoria Vance (CEO)",
          role: "Chief Executive Officer",
          station: "executive_suite",
          position: [0, 1, -12],
          status: "idle",
          behavioralState: "IDLE",
          appearance: "executive-ceo",
          color: "#f59e0b",
          isDemo: false,
        },
        "agent-eng-lead": {
          id: "agent-eng-lead",
          name: "David Chen (CTO)",
          role: "VP of Engineering",
          station: "engineering_bay",
          position: [-14, 1, -4],
          status: "idle",
          behavioralState: "IDLE",
          appearance: "engineer-lead",
          color: "#3b82f6",
          isDemo: false,
        },
      },
    });
  });

  describe("A. Authoritative Behavioral State Synchronization", () => {
    it("should update behavioralState and backwards-compatible operational status on agent.behavioral_state_changed", () => {
      const statesToVerify: Array<{
        behavioral: string;
        expectedOp: string;
      }> = [
        { behavioral: "PLANNING", expectedOp: "working" },
        { behavioral: "THINKING", expectedOp: "working" },
        { behavioral: "WORKING", expectedOp: "working" },
        { behavioral: "COMMUNICATING", expectedOp: "working" },
        { behavioral: "MOVING", expectedOp: "working" },
        { behavioral: "WAITING", expectedOp: "waiting_approval" },
        { behavioral: "ERROR", expectedOp: "error" },
        { behavioral: "COMPLETED", expectedOp: "idle" },
        { behavioral: "IDLE", expectedOp: "idle" },
      ];

      statesToVerify.forEach((item, idx) => {
        const evt: EventEnvelope = {
          schema_version: 1,
          event_id: `evt_behav_${idx}`,
          event_type: "agent.behavioral_state_changed",
          occurred_at: new Date().toISOString(),
          sequence_id: idx + 1,
          agent_id: "agent-exec-ceo",
          task_id: "task-behav-1",
          organization_id: "org_default_company",
          payload: {
            agent_id: "agent-exec-ceo",
            behavioral_state: item.behavioral,
            operational_status: item.expectedOp,
            reason: `Transition to ${item.behavioral}`,
          },
        };

        useWorldStore.getState().applyEvent(evt);
        const ceo = useWorldStore.getState().agents["agent-exec-ceo"];
        expect(ceo.behavioralState).toBe(item.behavioral);
        expect(ceo.status).toBe(item.expectedOp);
      });
    });
  });

  describe("B. Hybrid Spatial Navigation & Waypoint Interpolation", () => {
    it("should consume agent.movement_started and smoothly interpolate position along waypoints without teleporting", () => {
      const startEvt: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_move_start_1",
        event_type: "agent.movement_started",
        occurred_at: new Date().toISOString(),
        sequence_id: 10,
        agent_id: "agent-exec-ceo",
        task_id: null,
        organization_id: "org_default_company",
        payload: {
          movement_id: "mov-test-001",
          agent_id: "agent-exec-ceo",
          behavioral_state: "MOVING",
          destination: "support_lounge",
          target_position: { x: 0, y: 1, z: 11 },
          speed: 5.0,
          waypoints: [
            { index: 0, node_id: "origin", label: "Origin", x: 0, y: 1, z: -12 },
            { index: 1, node_id: "corridor_north", label: "Corridor North", x: 0, y: 1, z: -6 },
            { index: 2, node_id: "corridor_center", label: "Corridor Center", x: 0, y: 1, z: 3 },
            { index: 3, node_id: "support_lounge", label: "Support Lounge", x: 0, y: 1, z: 11 },
          ],
        },
      };

      useWorldStore.getState().applyEvent(startEvt);
      let ceo = useWorldStore.getState().agents["agent-exec-ceo"];

      // Must start at origin [0, 1, -12], NOT teleport to [0, 1, 11]
      expect(ceo.position).toEqual([0, 1, -12]);
      expect(ceo.isMoving).toBe(true);
      expect(ceo.behavioralState).toBe("MOVING");
      expect(ceo.activeMovementId).toBe("mov-test-001");
      expect(ceo.movementPlan?.waypoints.length).toBeGreaterThanOrEqual(4);

      // Step 1.0s at speed 5.0 (4x 0.25s steps = 5.0 units along +Z)
      for (let i = 0; i < 4; i++) {
        useWorldStore.getState().stepAgentSpatialMovement("agent-exec-ceo", 0.25);
      }
      ceo = useWorldStore.getState().agents["agent-exec-ceo"];
      expect(ceo.position[2]).toBeCloseTo(-7.0, 2);
      expect(ceo.isMoving).toBe(true);

      // Complete movement event commits final destination
      const completeEvt: EventEnvelope = {
        schema_version: 1,
        event_id: "evt_move_done_1",
        event_type: "agent.movement_completed",
        occurred_at: new Date().toISOString(),
        sequence_id: 11,
        agent_id: "agent-exec-ceo",
        task_id: null,
        organization_id: "org_default_company",
        payload: {
          movement_id: "mov-test-001",
          agent_id: "agent-exec-ceo",
          destination: "support_lounge",
          position: { x: 0, y: 1, z: 11 },
          behavioral_state: "IDLE",
          operational_status: "idle",
        },
      };

      useWorldStore.getState().applyEvent(completeEvt);
      ceo = useWorldStore.getState().agents["agent-exec-ceo"];
      expect(ceo.position).toEqual([0, 1, 11]);
      expect(ceo.station).toBe("support_lounge");
      expect(ceo.isMoving).toBe(false);
      expect(ceo.behavioralState).toBe("IDLE");
      expect(ceo.activeMovementId).toBeNull();
    });

    it("should rotate agent toward movement direction and interpolate shortest angle arc", () => {
      // Moving along +X axis ([0, 1, 0] -> [10, 1, 0]) -> atan2(10, 0) = +PI/2
      const headingEast = computeHeadingRadians([0, 1, 0], [10, 1, 0]);
      expect(headingEast).toBeCloseTo(Math.PI / 2, 4);

      // Moving along -X axis ([0, 1, 0] -> [-10, 1, 0]) -> atan2(-10, 0) = -PI/2
      const headingWest = computeHeadingRadians([0, 1, 0], [-10, 1, 0]);
      expect(headingWest).toBeCloseTo(-Math.PI / 2, 4);

      // Shortest-arc wrap across -PI / +PI boundary
      const wrapped = lerpAngleRadians(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
      expect(Math.abs(wrapped)).toBeCloseTo(Math.PI, 2);
    });

    it("should handle movement interruption and mid-flight destination rerouting without teleporting to origin", () => {
      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_reroute_1",
        event_type: "agent.movement_started",
        occurred_at: new Date().toISOString(),
        sequence_id: 20,
        agent_id: "agent-eng-lead",
        task_id: null,
        organization_id: "org_default_company",
        payload: {
          movement_id: "mov-initial",
          destination: "research_lab",
          target_position: { x: 14, y: 1, z: -4 },
          speed: 8.0,
          waypoints: [
            { node_id: "origin", x: -14, y: 1, z: -4 },
            { node_id: "research_lab", x: 14, y: 1, z: -4 },
          ],
        },
      });

      // Advance 4 steps of 0.25s at speed 8.0 -> moves 8 units from x=-14 to x=-6
      for (let i = 0; i < 4; i++) {
        useWorldStore.getState().stepAgentSpatialMovement("agent-eng-lead", 0.25);
      }
      const midPos = [...useWorldStore.getState().agents["agent-eng-lead"].position];
      expect(midPos[0]).toBeCloseTo(-6.0, 2);

      // Now reroute mid-stride to marketing_studio [-14, 1, 10]
      useWorldStore.getState().applyEvent({
        schema_version: 1,
        event_id: "evt_reroute_2",
        event_type: "agent.movement_started",
        occurred_at: new Date().toISOString(),
        sequence_id: 21,
        agent_id: "agent-eng-lead",
        task_id: null,
        organization_id: "org_default_company",
        payload: {
          movement_id: "mov-rerouted",
          destination: "marketing_studio",
          target_position: { x: -14, y: 1, z: 10 },
          speed: 8.0,
          waypoints: [
            { node_id: "corridor_south_west", x: -7, y: 1, z: 10 },
            { node_id: "marketing_studio", x: -14, y: 1, z: 10 },
          ],
        },
      });

      const reroutedAgent = useWorldStore.getState().agents["agent-eng-lead"];
      // Must anchor from current visual position [-6, 1, -4], NOT teleport!
      expect(reroutedAgent.position[0]).toBeCloseTo(-6.0, 2);
      expect(reroutedAgent.movementPlan?.origin[0]).toBeCloseTo(-6.0, 2);
      expect(reroutedAgent.activeMovementId).toBe("mov-rerouted");
    });
  });

  describe("C. Reconnect Position Reconciliation (Anti-Teleportation Invariant)", () => {
    it("should smoothly interpolate rather than teleport when an existing agent position changes on reconnect snapshot", () => {
      // Existing non-demo agent is at [-14, 1, -4]
      // Reconnect snapshot reports new position [-6, 1, 20] (within normal office bounds < 32u)
      useWorldStore.getState().syncAgentsFromBackend([
        {
          id: "agent-eng-lead",
          name: "David Chen (CTO)",
          role: "VP of Engineering",
          station: "operations_hub",
          pos_x: -6,
          pos_y: 1,
          pos_z: 20,
          status: "working",
          behavioral_state: "MOVING",
        },
      ]);

      const cto = useWorldStore.getState().agents["agent-eng-lead"];
      // Visual position remains at [-14, 1, -4] and a smooth movementPlan is created toward [-6, 1, 20]
      expect(cto.position).toEqual([-14, 1, -4]);
      expect(cto.isMoving).toBe(true);
      expect(cto.targetPosition).toEqual([-6, 1, 20]);

      // Advancing frames moves the agent smoothly toward [-6, 1, 20]
      const stepped = stepAgentMovement(cto, 0.25);
      expect(distance3D(stepped.position, [-6, 1, 20])).toBeLessThan(
        distance3D(cto.position, [-6, 1, 20])
      );
    });

    it("should allow direct placement only during initial hydration or explicit emergency recovery", () => {
      const initialPlacement = reconcileAgentPositionOnSnapshot(
        undefined,
        [14, 1, 10],
        null,
        null,
        null,
        "IDLE",
        "idle",
        false
      );
      expect(initialPlacement.position).toEqual([14, 1, 10]);
      expect(initialPlacement.isMoving).toBe(false);
    });
  });
});

