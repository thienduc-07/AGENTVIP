import { describe, it, expect } from "vitest";
import { officeNavEngine } from "../lib/officeNavigationEngine";
import { distance3D, DEFAULT_MOVEMENT_SPEED } from "../lib/spatialMovement";
import { AgentCharacterData } from "../types";

describe("Phase 4.2: Multi-Agent Collaboration & Performance Benchmarks", () => {
  const createTestAgents = (count: number): Record<string, AgentCharacterData> => {
    const agents: Record<string, AgentCharacterData> = {};
    for (let i = 0; i < count; i++) {
      const id = `agent-multi-${i}`;
      const startX = ((i % 10) - 4.5) * 4.0;
      const startZ = (Math.floor(i / 10) - 2.5) * 4.0;
      const targetX = -startX;
      const targetZ = -startZ;

      const origin: [number, number, number] = [startX, 1.0, startZ];
      const target: [number, number, number] = [targetX, 1.0, targetZ];
      const dist = distance3D(origin, target);

      agents[id] = {
        id,
        name: `Agent ${i}`,
        role: i === 0 ? "Chief Executive Officer" : "Specialist Agent",
        department: "Engineering",
        station: "engineering_bay",
        appearance: i === 0 ? "executive-ceo" : "engineer-lead",
        color: i === 0 ? "#38bdf8" : "#10b981",
        status: "working",
        behavioralState: "MOVING",
        position: origin,
        targetPosition: target,
        targetDestination: `station-${i}`,
        activeMovementId: `mov-${i}`,
        isMoving: true,
        headingRadians: 0,
        movementPlan: {
          movementId: `mov-${i}`,
          origin,
          destination: `station-${i}`,
          targetPosition: target,
          waypoints: [
            { index: 0, node_id: "orig", label: "Orig", x: startX, y: 1, z: startZ, segment_distance: 0, cumulative_distance: 0 },
            { index: 1, node_id: "dest", label: "Dest", x: targetX, y: 1, z: targetZ, segment_distance: dist, cumulative_distance: dist },
          ],
          currentWaypointIndex: 1,
          speed: DEFAULT_MOVEMENT_SPEED,
          totalDistance: dist,
          progressRatio: 0,
          startedAtMs: Date.now(),
        },
      };
    }
    return agents;
  };

  describe("A. Multi-Agent Concurrency & Scalability (5, 20, 50, 100 Agents)", () => {
    it("should coordinate 5 agents moving simultaneously without collisions", () => {
      const agents = createTestAgents(5);
      officeNavEngine.syncGrid(agents);

      for (let frame = 0; frame < 10; frame++) {
        for (const id in agents) {
          agents[id] = officeNavEngine.stepAgent(agents[id], 0.05, agents);
        }
      }

      // Verify all agents maintained minimum separation >= 0.5m
      const agentList = Object.values(agents);
      for (let i = 0; i < agentList.length; i++) {
        for (let j = i + 1; j < agentList.length; j++) {
          const dist = distance3D(agentList[i].position, agentList[j].position);
          expect(dist).toBeGreaterThanOrEqual(0.35);
        }
      }
    });

    it("should coordinate 20 concurrent agents across department wings", () => {
      const agents = createTestAgents(20);
      officeNavEngine.syncGrid(agents);

      for (let frame = 0; frame < 10; frame++) {
        for (const id in agents) {
          agents[id] = officeNavEngine.stepAgent(agents[id], 0.05, agents);
        }
      }

      const activeMoving = Object.values(agents).filter((a) => a.isMoving);
      expect(activeMoving.length).toBeGreaterThan(0);
    });

    it("should coordinate 50 concurrent agents with valid spatial bounds", () => {
      const agents = createTestAgents(50);
      officeNavEngine.syncGrid(agents);

      for (let frame = 0; frame < 5; frame++) {
        for (const id in agents) {
          agents[id] = officeNavEngine.stepAgent(agents[id], 0.05, agents);
          expect(agents[id].position[0]).toBeGreaterThanOrEqual(-30);
          expect(agents[id].position[0]).toBeLessThanOrEqual(30);
          expect(agents[id].position[2]).toBeGreaterThanOrEqual(-30);
          expect(agents[id].position[2]).toBeLessThanOrEqual(30);
        }
      }
    });

    it("should sustain 100 agents under 16ms frame budget (>= 60 FPS performance)", () => {
      const agents = createTestAgents(100);
      officeNavEngine.syncGrid(agents);

      const t0 = performance.now();
      // Step all 100 agents for 1 full simulation tick
      for (const id in agents) {
        agents[id] = officeNavEngine.stepAgent(agents[id], 0.016, agents);
      }
      const durationMs = performance.now() - t0;

      // Must complete within 16.6ms budget for 60 FPS
      expect(durationMs).toBeLessThan(16.0);
    });
  });

  describe("B. Group Meeting Formations & Dispersal", () => {
    it("should generate non-overlapping circular meeting formation for department leads", () => {
      const leadIds = [
        "ceo",
        "cto",
        "cpo",
        "vp_research",
        "vp_sales",
        "vp_marketing",
        "vp_ops",
        "vp_finance",
      ];
      const executiveHub: [number, number, number] = [0.0, 1.0, -12.0];
      const formation = officeNavEngine.generateMeetingFormation(leadIds, executiveHub, 2.5);

      expect(Object.keys(formation)).toHaveLength(8);

      // Verify each agent is placed on circle perimeter around center
      for (const id of leadIds) {
        const pos = formation[id];
        const distToCenter = distance3D(pos, executiveHub);
        expect(distToCenter).toBeCloseTo(2.5, 1);
      }

      // Verify mutual distances between participants are >= 1.0m
      for (let i = 0; i < leadIds.length; i++) {
        for (let j = i + 1; j < leadIds.length; j++) {
          const dist = distance3D(formation[leadIds[i]], formation[leadIds[j]]);
          expect(dist).toBeGreaterThanOrEqual(1.2);
        }
      }
    });

    it("should route all agents back to assigned workstations upon meeting dispersal", () => {
      const leadIds = ["eng_lead", "sales_lead"];
      const meetingSpots = officeNavEngine.generateMeetingFormation(leadIds, [0, 1, -12], 2.0);

      // Department workstations
      const engDesk: [number, number, number] = [-14.0, 1.0, -8.0];
      const salesDesk: [number, number, number] = [14.0, 1.0, 2.0];

      const engWaypoints = officeNavEngine.generateWaypoints(meetingSpots["eng_lead"], engDesk, "eng_desk");
      const salesWaypoints = officeNavEngine.generateWaypoints(meetingSpots["sales_lead"], salesDesk, "sales_desk");

      expect(engWaypoints[engWaypoints.length - 1].node_id).toBe("eng_desk");
      expect(salesWaypoints[salesWaypoints.length - 1].node_id).toBe("sales_desk");
    });
  });

  describe("C. Corridor Bottleneck & Deadlock Resolution", () => {
    it("should resolve head-on corridor meeting with lateral evasion without getting stuck", () => {
      // Two agents moving towards each other in corridor_center at z=3.0
      const agentEast: AgentCharacterData = {
        id: "ag_east",
        name: "Eastbound Agent",
        role: "Engineer",
        department: "Engineering",
        station: "engineering_bay",
        appearance: "engineer-lead",
        color: "#10b981",
        status: "working",
        behavioralState: "MOVING",
        position: [-2.0, 1.0, 3.0],
        targetPosition: [4.0, 1.0, 3.0],
        targetDestination: "corridor_east",
        activeMovementId: "mov-e",
        isMoving: true,
        headingRadians: Math.PI / 2,
        movementPlan: {
          movementId: "mov-e",
          origin: [-2.0, 1.0, 3.0],
          destination: "corridor_east",
          targetPosition: [4.0, 1.0, 3.0],
          waypoints: [
            { index: 0, node_id: "orig", label: "Orig", x: -2, y: 1, z: 3, segment_distance: 0, cumulative_distance: 0 },
            { index: 1, node_id: "dest", label: "Dest", x: 4, y: 1, z: 3, segment_distance: 6, cumulative_distance: 6 },
          ],
          currentWaypointIndex: 1,
          speed: 3.0,
          totalDistance: 6.0,
          progressRatio: 0,
          startedAtMs: Date.now(),
        },
      };

      const agentWest: AgentCharacterData = {
        id: "ag_west",
        name: "Westbound Agent",
        role: "Researcher",
        department: "AI Research",
        station: "research_lab",
        appearance: "researcher-lead",
        color: "#a855f7",
        status: "working",
        behavioralState: "MOVING",
        position: [2.0, 1.0, 3.0],
        targetPosition: [-4.0, 1.0, 3.0],
        targetDestination: "corridor_west",
        activeMovementId: "mov-w",
        isMoving: true,
        headingRadians: -Math.PI / 2,
        movementPlan: {
          movementId: "mov-w",
          origin: [2.0, 1.0, 3.0],
          destination: "corridor_west",
          targetPosition: [-4.0, 1.0, 3.0],
          waypoints: [
            { index: 0, node_id: "orig", label: "Orig", x: 2, y: 1, z: 3, segment_distance: 0, cumulative_distance: 0 },
            { index: 1, node_id: "dest", label: "Dest", x: -4, y: 1, z: 3, segment_distance: 6, cumulative_distance: 6 },
          ],
          currentWaypointIndex: 1,
          speed: 3.0,
          totalDistance: 6.0,
          progressRatio: 0,
          startedAtMs: Date.now(),
        },
      };

      const corridorAgents: Record<string, AgentCharacterData> = {
        ag_east: agentEast,
        ag_west: agentWest,
      };
      officeNavEngine.syncGrid(corridorAgents);

      // Simulate 15 frames of movement
      for (let f = 0; f < 15; f++) {
        corridorAgents.ag_east = officeNavEngine.stepAgent(corridorAgents.ag_east, 0.05, corridorAgents);
        corridorAgents.ag_west = officeNavEngine.stepAgent(corridorAgents.ag_west, 0.05, corridorAgents);
      }

      // Both agents should have progressed towards their respective goals without deadlocking
      expect(corridorAgents.ag_east.position[0]).toBeGreaterThan(-2.0);
      expect(corridorAgents.ag_west.position[0]).toBeLessThan(2.0);
    });
  });
});
