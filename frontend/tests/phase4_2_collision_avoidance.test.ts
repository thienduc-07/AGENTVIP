import { describe, it, expect, beforeEach } from "vitest";
import { SpatialHashGrid } from "../lib/spatialHashGrid";
import {
  CollisionAvoidanceSystem,
  AgentSteeringState,
  DEFAULT_AVOIDANCE_CONFIG,
} from "../lib/collisionAvoidance";

describe("Phase 4.2: Collision Avoidance & Spatial Partitioning", () => {
  let grid: SpatialHashGrid<AgentSteeringState>;
  let avoidance: CollisionAvoidanceSystem;

  beforeEach(() => {
    grid = new SpatialHashGrid<AgentSteeringState>(3.5);
    avoidance = new CollisionAvoidanceSystem();
  });

  describe("A. Spatial Hash Grid (O(1) Spatial Partitioning)", () => {
    it("should insert items and query neighbors within radius correctly", () => {
      grid.insert("agent_a", 0.0, 0.0, 0.5, {
        id: "agent_a",
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        radius: 0.5,
        priority: 50,
      });
      grid.insert("agent_b", 1.0, 0.0, 0.5, {
        id: "agent_b",
        x: 1.0,
        z: 0,
        vx: 0,
        vz: 0,
        radius: 0.5,
        priority: 50,
      });
      grid.insert("agent_c", 10.0, 10.0, 0.5, {
        id: "agent_c",
        x: 10.0,
        z: 10.0,
        vx: 0,
        vz: 0,
        radius: 0.5,
        priority: 50,
      });

      expect(grid.size()).toBe(3);

      // Query radius 1.5 around origin should find agent_a and agent_b, but NOT agent_c
      const neighbors = grid.queryRadius(0, 0, 1.5);
      const neighborIds = neighbors.map((n) => n.id);
      expect(neighborIds).toContain("agent_a");
      expect(neighborIds).toContain("agent_b");
      expect(neighborIds).not.toContain("agent_c");
    });

    it("should update positions across grid cells seamlessly", () => {
      grid.insert("moving_agent", 0.0, 0.0, 0.5, {
        id: "moving_agent",
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        radius: 0.5,
        priority: 50,
      });

      // Move into adjacent grid cell (> 3.5m away)
      grid.update("moving_agent", 8.0, 8.0);

      // Query old origin -> should be empty
      const nearOld = grid.queryRadius(0, 0, 1.5);
      expect(nearOld).toHaveLength(0);

      // Query new position -> should find agent
      const nearNew = grid.queryRadius(8.0, 8.0, 1.5);
      expect(nearNew).toHaveLength(1);
      expect(nearNew[0].id).toBe("moving_agent");
    });

    it("should support zero-allocation reusable array queries", () => {
      grid.insert("ag_1", 2.0, 2.0, 0.5, { id: "ag_1", x: 2, z: 2, vx: 0, vz: 0, radius: 0.5, priority: 50 });
      const reusableBuffer: any[] = [];

      const count = grid.queryRadiusAllocFree(2.0, 2.0, 1.0, reusableBuffer);
      expect(count).toBe(1);
      expect(reusableBuffer[0].id).toBe("ag_1");
    });
  });

  describe("B. Dynamic Agent-to-Agent Separation & Right-of-Way", () => {
    it("should generate mutual repulsive forces when two agents are within personal buffer", () => {
      const agentA: AgentSteeringState = {
        id: "agent_a",
        x: 0.0,
        z: 0.0,
        vx: 2.0,
        vz: 0.0,
        radius: 0.5,
        priority: 50,
      };
      const agentB: AgentSteeringState = {
        id: "agent_b",
        x: 0.6, // Only 0.6m away along X (< 1.4m avoidance radius)
        z: 0.0,
        vx: 0.0,
        vz: 0.0,
        radius: 0.5,
        priority: 50,
      };

      grid.insert(agentA.id, agentA.x, agentA.z, 0.5, agentA);
      grid.insert(agentB.id, agentB.x, agentB.z, 0.5, agentB);

      // Compute steering for agent A: agent B is to the right (+X), so repulsion pushes agent A left (-X)
      const [steerAx, steerAz] = avoidance.computeSteeringVelocity(agentA, grid, 2.0, 0.0);
      expect(steerAx).toBeLessThan(2.0); // Repulsion slows down / deflects leftward
    });

    it("should apply lateral evasion to the right when agents are on a head-on collision course", () => {
      // Agent 1 moving East (+X) along corridor
      const agent1: AgentSteeringState = {
        id: "ag_east",
        x: 0.0,
        z: 0.0,
        vx: 3.0,
        vz: 0.0,
        radius: 0.5,
        priority: 50,
      };
      // Agent 2 moving West (-X) directly towards Agent 1
      const agent2: AgentSteeringState = {
        id: "ag_west",
        x: 1.0,
        z: 0.0,
        vx: -3.0,
        vz: 0.0,
        radius: 0.5,
        priority: 50,
      };

      grid.insert(agent1.id, agent1.x, agent1.z, 0.5, agent1);
      grid.insert(agent2.id, agent2.x, agent2.z, 0.5, agent2);

      const [v1x, v1z] = avoidance.computeSteeringVelocity(agent1, grid, 3.0, 0.0);
      // For motion along +X, the perpendicular vector to the right is +Z (Three.js coords)
      expect(Math.abs(v1z)).toBeGreaterThan(0.2);
    });

    it("should respect priority right-of-way (lower priority yields more strongly)", () => {
      const ceo: AgentSteeringState = {
        id: "agent_ceo",
        x: 0.0,
        z: 0.0,
        vx: 0.0,
        vz: 2.0,
        radius: 0.5,
        priority: 100, // CEO priority
      };
      const intern: AgentSteeringState = {
        id: "agent_intern",
        x: 0.0,
        z: 0.8,
        vx: 0.0,
        vz: -2.0,
        radius: 0.5,
        priority: 10,  // Lower priority
      };

      grid.insert(ceo.id, ceo.x, ceo.z, 0.5, ceo);
      grid.insert(intern.id, intern.x, intern.z, 0.5, intern);

      const [, internSteerZ] = avoidance.computeSteeringVelocity(intern, grid, 0.0, -2.0);
      const [, ceoSteerZ] = avoidance.computeSteeringVelocity(ceo, grid, 0.0, 2.0);

      // Intern yields more strongly than CEO
      expect(Math.abs(internSteerZ - (-2.0))).toBeGreaterThan(Math.abs(ceoSteerZ - 2.0));
    });
  });

  describe("C. Static Obstacle AABB & Boundary Avoidance", () => {
    it("should push agents away from workstation desk bounding boxes", () => {
      // Register desk centered at (0, 0) with width 2.2m (X: [-1.1, 1.1]) and depth 1.0m (Z: [-0.5, 0.5])
      avoidance.registerWorkstations([{ id: "desk_1", x: 0, z: 0, width: 2.2, depth: 1.0 }]);

      // Agent approaches desk from the South at (0, 0.8) moving North (-Z)
      const agent: AgentSteeringState = {
        id: "agent_desk_tester",
        x: 0.0,
        z: 0.7,
        vx: 0.0,
        vz: -2.0,
        radius: 0.5,
        priority: 50,
      };
      grid.insert(agent.id, agent.x, agent.z, 0.5, agent);

      const [, vz] = avoidance.computeSteeringVelocity(agent, grid, 0.0, -2.0);
      // Desk repulsion pushes away in +Z direction
      expect(vz).toBeGreaterThan(-2.0);
    });

    it("should enforce office boundary constraints against perimeter walls", () => {
      // Agent placed near eastern glass wall (x = 28.0, limit = 28.5) moving East (+X)
      const agent: AgentSteeringState = {
        id: "wall_tester",
        x: 28.2,
        z: 0.0,
        vx: 2.0,
        vz: 0.0,
        radius: 0.5,
        priority: 50,
      };
      grid.insert(agent.id, agent.x, agent.z, 0.5, agent);

      const [steeredVx] = avoidance.computeSteeringVelocity(agent, grid, 2.0, 0.0);
      // Boundary pushes inward (-X)
      expect(steeredVx).toBeLessThan(0);
    });

    it("should detect when a navigation segment intersects a static obstacle", () => {
      avoidance.registerObstacle({
        id: "obs_wall",
        minX: -2.0,
        maxX: 2.0,
        minZ: 4.0,
        maxZ: 6.0,
        type: "wall",
      });

      const p1: [number, number] = [0.0, 0.0];
      const p2: [number, number] = [0.0, 10.0]; // Segment crosses the wall at z=4..6
      const isBlocked = avoidance.isSegmentBlocked(p1, p2);
      expect(isBlocked).toBe(true);

      const p3: [number, number] = [10.0, 0.0];
      const p4: [number, number] = [10.0, 10.0]; // Segment bypasses the wall (x=10)
      const isClear = avoidance.isSegmentBlocked(p3, p4);
      expect(isClear).toBe(false);
    });
  });
});
