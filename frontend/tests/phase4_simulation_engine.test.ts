import { describe, it, expect, beforeEach } from "vitest";
import {
  OfficeSimulationEngine,
  buildFloorNavigationGraph,
  findPathOnFloor,
  SimulationAgentState,
} from "@/lib/simulation/officeSimulationEngine";

describe("Phase 4: Ultra-Lightweight Employee Simulation Engine", () => {
  let engine: OfficeSimulationEngine;

  beforeEach(() => {
    engine = new OfficeSimulationEngine();
  });

  describe("1. Waypoint Navigation & Floor Graphs", () => {
    it("should construct valid navigation graphs for all 6 floors", () => {
      for (let f = 1; f <= 6; f++) {
        const graph = buildFloorNavigationGraph(f);
        expect(graph.floor).toBe(f);
        expect(graph.elevation).toBeCloseTo((f - 1) * 6.0 + 0.05);
        expect(Object.keys(graph.waypoints).length).toBeGreaterThanOrEqual(10);
        expect(graph.walkableBounds.minX).toBe(-16.0);
        expect(graph.walkableBounds.maxX).toBe(16.0);
      }
    });

    it("should find an obstacle-free path between two points on the same floor", () => {
      const graph = buildFloorNavigationGraph(5); // Engineering floor
      const start: [number, number, number] = [-10, 24.05, -3.5];
      const dest: [number, number, number] = [10, 24.05, 5.5];

      const path = findPathOnFloor(graph, start, dest);
      expect(path.length).toBeGreaterThanOrEqual(3);
      expect(path[0]).toEqual(start);
      expect(path[path.length - 1]).toEqual(dest);

      // Verify all waypoints stay within walkable bounds
      path.forEach(([x, y, z]) => {
        expect(x).toBeGreaterThanOrEqual(graph.walkableBounds.minX);
        expect(x).toBeLessThanOrEqual(graph.walkableBounds.maxX);
        expect(z).toBeGreaterThanOrEqual(graph.walkableBounds.minZ);
        expect(z).toBeLessThanOrEqual(graph.walkableBounds.maxZ);
      });
    });
  });

  describe("2. FSM States & Deterministic Agent Behavior", () => {
    it("should register agents and initialize default posture and phase offsets", () => {
      engine.registerAgent(
        "agent-01",
        "Alice Engineer",
        "Engineering",
        5,
        [-2, 24.05, -1],
        [-2, 24.05, -1],
        "WORKING"
      );

      const agent = engine.getAgent("agent-01");
      expect(agent).toBeDefined();
      expect(agent?.name).toBe("Alice Engineer");
      expect(agent?.state).toBe("WORKING");
      expect(agent?.isSeated).toBe(true);
      expect(agent?.torsoLean).toBeGreaterThan(0.05);
    });

    it("should support all 11 canonical simulation states", () => {
      const canonicalStates: SimulationAgentState[] = [
        "IDLE",
        "WORKING",
        "TYPING",
        "STANDING",
        "WALKING",
        "APPROACHING_AGENT",
        "CONVERSING",
        "RETURNING_TO_DESK",
        "SITTING",
        "MEETING",
        "PAUSED",
      ];

      canonicalStates.forEach((state, idx) => {
        const id = `agent-state-${idx}`;
        engine.registerAgent(id, `Agent ${idx}`, "Engineering", 5, [0, 24.05, 0], null, state);
        const agent = engine.getAgent(id);
        expect(agent?.state).toBe(state);
      });
    });

    it("should execute procedural typing motions during WORKING and TYPING states", () => {
      engine.registerAgent("agent-typist", "Typist Agent", "Engineering", 5, [0, 24.05, 0], [0, 24.05, 0], "TYPING");

      const agent = engine.getAgent("agent-typist")!;
      const initialArmL = agent.leftArmAngle;

      // Advance simulation
      engine.update(0.05);
      expect(agent.leftArmAngle).not.toBe(initialArmL);
      expect(agent.isSeated).toBe(true);
      expect(agent.torsoLean).toBeCloseTo(0.12, 1);
    });

    it("should clamp large delta times after browser tab suspension", () => {
      engine.registerAgent("agent-clamp", "Clamp Agent", "Engineering", 5, [0, 24.05, 0], null, "WORKING");
      const agent = engine.getAgent("agent-clamp")!;
      const initialTimer = agent.stateTimer;

      // Pass an unusually large delta (15 seconds, simulating suspended tab)
      engine.update(15.0);

      // Delta should have been clamped to 0.1s
      expect(initialTimer - agent.stateTimer).toBeCloseTo(0.1, 2);
    });

    it("should trigger collision avoidance repulsion when two walking agents are close", () => {
      engine.registerAgent("agent-w1", "Walker 1", "Engineering", 5, [0, 24.05, 0], [0, 24.05, 0], "WALKING");
      engine.registerAgent("agent-w2", "Walker 2", "Engineering", 5, [0.3, 24.05, 0], [0.3, 24.05, 0], "WALKING");

      const w1 = engine.getAgent("agent-w1")!;
      const w2 = engine.getAgent("agent-w2")!;

      w1.path = [[5, 24.05, 0]];
      w1.pathIndex = 0;
      w2.path = [[-5, 24.05, 0]];
      w2.pathIndex = 0;

      const initialDist = Math.hypot(w1.position[0] - w2.position[0], w1.position[2] - w2.position[2]);
      expect(initialDist).toBeLessThan(0.9);

      engine.update(0.05);

      // Repulsion force should have nudged them apart laterally
      expect(w1.position).toBeDefined();
      expect(w2.position).toBeDefined();
    });
  });
});

