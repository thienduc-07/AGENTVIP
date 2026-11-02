import { describe, it, expect } from "vitest";
import {
  officeNavEngine,
  WORKSTATION_SCREEN_FACING_YAW,
} from "../lib/officeNavigationEngine";
import {
  distance3D,
  computeHeadingRadians,
  lerpAngleRadians,
  DEFAULT_MOVEMENT_SPEED,
} from "../lib/spatialMovement";
import { AgentCharacterData } from "../types";

describe("Phase 4.2: Agent Movement & Motion Control", () => {
  const createMockAgent = (overrides: Partial<AgentCharacterData> = {}): AgentCharacterData => ({
    id: "agent-test-1",
    name: "Alex Rivera",
    role: "Senior Fullstack Engineer",
    department: "Engineering",
    station: "engineering_bay",
    status: "idle",
    behavioralState: "IDLE",
    appearance: "engineer-lead",
    color: "#10b981",
    position: [-14.0, 1.0, -8.0],
    targetPosition: null,
    targetDestination: null,
    activeMovementId: null,
    movementPlan: null,
    isMoving: false,
    headingRadians: 0,
    ...overrides,
  });

  describe("A. Continuous Velocity & Waypoint Progression", () => {
    it("should step smoothly along waypoints without teleporting", () => {
      const origin: [number, number, number] = [0.0, 1.0, 0.0];
      const target: [number, number, number] = [0.0, 1.0, 12.0];
      const waypoints = [
        { index: 0, node_id: "origin", label: "Origin", x: 0, y: 1, z: 0, segment_distance: 0, cumulative_distance: 0 },
        { index: 1, node_id: "wp_1", label: "WP1", x: 0, y: 1, z: 6, segment_distance: 6, cumulative_distance: 6 },
        { index: 2, node_id: "dest", label: "Dest", x: 0, y: 1, z: 12, segment_distance: 6, cumulative_distance: 12 },
      ];

      let agent = createMockAgent({
        position: origin,
        targetPosition: target,
        isMoving: true,
        movementPlan: {
          movementId: "mov-1",
          origin,
          destination: "dest",
          targetPosition: target,
          waypoints,
          currentWaypointIndex: 1,
          speed: 4.0,
          totalDistance: 12.0,
          progressRatio: 0,
          startedAtMs: Date.now(),
        },
      });

      // Step 2 frames of 0.25s (total 0.5s) -> 4.0 * 0.5 = 2.0m forward along Z
      agent = officeNavEngine.stepAgent(agent, 0.25);
      agent = officeNavEngine.stepAgent(agent, 0.25);
      expect(agent.position[2]).toBeCloseTo(2.0, 1);
      expect(agent.position[0]).toBeCloseTo(0.0, 1);
      expect(agent.isMoving).toBe(true);

      // Step 5 frames of 0.25s (total 1.25s) -> moves past WP1 (z=6) towards Dest (z=12)
      for (let i = 0; i < 5; i++) {
        agent = officeNavEngine.stepAgent(agent, 0.25);
      }
      expect(agent.position[2]).toBeGreaterThan(6.0);
      expect(agent.movementPlan?.currentWaypointIndex).toBeGreaterThanOrEqual(2);
    });

    it("should clamp excessive deltaSeconds to prevent physics tunneling on frame drops", () => {
      const origin: [number, number, number] = [0, 1, 0];
      const target: [number, number, number] = [0, 1, 20];
      const waypoints = [
        { index: 0, node_id: "origin", label: "Origin", x: 0, y: 1, z: 0, segment_distance: 0, cumulative_distance: 0 },
        { index: 1, node_id: "target", label: "Target", x: 0, y: 1, z: 20, segment_distance: 20, cumulative_distance: 20 },
      ];

      const agent = createMockAgent({
        position: origin,
        targetPosition: target,
        isMoving: true,
        movementPlan: {
          movementId: "mov-tun",
          origin,
          destination: "target",
          targetPosition: target,
          waypoints,
          currentWaypointIndex: 1,
          speed: 4.0,
          totalDistance: 20.0,
          progressRatio: 0,
          startedAtMs: Date.now(),
        },
      });

      // Pass large frame drop dt = 5.0 seconds
      // dt is clamped to max 0.25s per step -> maximum distance traveled is 4.0 * 0.25 = 1.0m
      const stepped = officeNavEngine.stepAgent(agent, 5.0);
      const distTraveled = distance3D(origin, stepped.position);
      expect(distTraveled).toBeLessThanOrEqual(1.5);
      expect(stepped.position[2]).toBeCloseTo(1.0, 1);
    });
  });

  describe("B. Arrival Precision & Workstation Screen Orientation", () => {
    it("should smoothly decelerate within 1.5m of destination", () => {
      const origin: [number, number, number] = [0, 1, 9.0];
      const target: [number, number, number] = [0, 1, 10.0]; // 1.0m remaining (< 1.5m)
      const waypoints = [
        { index: 0, node_id: "origin", label: "Origin", x: 0, y: 1, z: 9, segment_distance: 0, cumulative_distance: 0 },
        { index: 1, node_id: "target", label: "Target", x: 0, y: 1, z: 10, segment_distance: 1, cumulative_distance: 1 },
      ];

      const agent = createMockAgent({
        position: origin,
        targetPosition: target,
        isMoving: true,
        movementPlan: {
          movementId: "mov-arr",
          origin,
          destination: "target",
          targetPosition: target,
          waypoints,
          currentWaypointIndex: 1,
          speed: 4.0,
          totalDistance: 1.0,
          progressRatio: 0,
          startedAtMs: Date.now(),
        },
      });

      // At 1.0m remaining, speed should scale down smoothly
      const stepped = officeNavEngine.stepAgent(agent, 0.1);
      const stepDist = distance3D(origin, stepped.position);
      // At full speed 4.0 * 0.1 = 0.4m; decelerated speed should be less
      expect(stepDist).toBeLessThan(0.4);
      expect(stepDist).toBeGreaterThan(0.05);
    });

    it("should settle cleanly at workstation chair and orient facing monitors (-Z axis)", () => {
      const nearDeskChair: [number, number, number] = [-12.0, 1.0, -3.36];
      const deskChairTarget: [number, number, number] = [-12.0, 1.0, -3.35];
      const waypoints = [
        { index: 0, node_id: "origin", label: "Origin", x: -12.0, y: 1, z: -3.36, segment_distance: 0, cumulative_distance: 0 },
        { index: 1, node_id: "desk_chair", label: "Workstation Chair", x: -12.0, y: 1, z: -3.35, segment_distance: 0.01, cumulative_distance: 0.01 },
      ];

      const agent = createMockAgent({
        position: nearDeskChair,
        targetPosition: deskChairTarget,
        isMoving: true,
        headingRadians: 0,
        movementPlan: {
          movementId: "mov-desk",
          origin: nearDeskChair,
          destination: "workstation_eng_1",
          targetPosition: deskChairTarget,
          waypoints,
          currentWaypointIndex: 1,
          speed: 4.0,
          totalDistance: 0.01,
          progressRatio: 0.99,
          startedAtMs: Date.now(),
        },
      });

      const arrived = officeNavEngine.stepAgent(agent, 0.1);
      expect(arrived.isMoving).toBe(false);
      expect(arrived.position).toEqual(deskChairTarget);
      // When arriving at workstation, heading should orient to facing screens (Math.PI)
      expect(arrived.headingRadians).toBeCloseTo(WORKSTATION_SCREEN_FACING_YAW, 3);
    });
  });

  describe("C. Angular Interpolation & Yaw Orientation", () => {
    it("should compute correct heading yaw angle facing towards target vector", () => {
      // Facing North (+Z forward in Three.js avatar coords, so moving in +Z is 0 rad)
      const hNorth = computeHeadingRadians([0, 1, 0], [0, 1, 10]);
      expect(hNorth).toBeCloseTo(0, 3);

      // Moving in +X (+90 deg or PI/2)
      const hEast = computeHeadingRadians([0, 1, 0], [10, 1, 0]);
      expect(hEast).toBeCloseTo(Math.PI / 2, 3);

      // Moving in -Z (Math.PI or -Math.PI)
      const hSouth = computeHeadingRadians([0, 1, 0], [0, 1, -10]);
      expect(Math.abs(hSouth)).toBeCloseTo(Math.PI, 3);
    });

    it("should interpolate shortest angular arc across PI boundary without 360-degree spinning", () => {
      const current = Math.PI - 0.1;
      const target = -Math.PI + 0.1;
      // Arc difference across PI boundary is only 0.2 radians
      const lerped = lerpAngleRadians(current, target, 0.5);
      expect(Math.abs(lerped)).toBeCloseTo(Math.PI, 1);
    });
  });
});
