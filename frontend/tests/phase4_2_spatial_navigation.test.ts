import { describe, it, expect } from "vitest";
import {
  officeNavEngine,
  OFFICE_TOPOLOGY_NODES,
  OFFICE_TOPOLOGY_EDGES,
  WORKSTATION_CHAIR_OFFSET_Z,
  WORKSTATION_SCREEN_FACING_YAW,
} from "../lib/officeNavigationEngine";
import { distance3D } from "../lib/spatialMovement";

describe("Phase 4.2: Spatial Navigation Engine", () => {
  describe("A. Office Topology Structure & Connectivity", () => {
    it("should register all 8 department zones and 7 corridor junction nodes", () => {
      const nodeKeys = Object.keys(OFFICE_TOPOLOGY_NODES);
      expect(nodeKeys).toHaveLength(15);

      const expectedZones = [
        "executive_suite",
        "engineering_bay",
        "research_lab",
        "marketing_studio",
        "sales_wing",
        "operations_hub",
        "finance_office",
        "support_lounge",
      ];
      for (const zone of expectedZones) {
        expect(OFFICE_TOPOLOGY_NODES[zone]).toBeDefined();
        expect(OFFICE_TOPOLOGY_NODES[zone].node_type).toBe("zone");
      }

      const expectedCorridors = [
        "corridor_north",
        "corridor_north_west",
        "corridor_north_east",
        "corridor_center",
        "corridor_south_west",
        "corridor_south_east",
        "corridor_south",
      ];
      for (const corridor of expectedCorridors) {
        expect(OFFICE_TOPOLOGY_NODES[corridor]).toBeDefined();
        expect(OFFICE_TOPOLOGY_NODES[corridor].node_type).toBe("corridor");
      }
    });

    it("should have all topology nodes within valid office bounds [-30, 30] x [-30, 30]", () => {
      for (const [nid, node] of Object.entries(OFFICE_TOPOLOGY_NODES)) {
        expect(node.x).toBeGreaterThanOrEqual(-30);
        expect(node.x).toBeLessThanOrEqual(30);
        expect(node.z).toBeGreaterThanOrEqual(-30);
        expect(node.z).toBeLessThanOrEqual(30);
        expect(node.y).toBe(1.0);
      }
    });

    it("should form a fully connected undirected graph without isolated islands", () => {
      // Find nearest and compute path between every pair of nodes
      const nodeKeys = Object.keys(OFFICE_TOPOLOGY_NODES);
      for (let i = 0; i < nodeKeys.length; i++) {
        for (let j = i + 1; j < nodeKeys.length; j++) {
          const u = nodeKeys[i];
          const v = nodeKeys[j];
          const path = officeNavEngine.findShortestPath(u, v);
          expect(path.length).toBeGreaterThanOrEqual(2);
          expect(path[0]).toBe(u);
          expect(path[path.length - 1]).toBe(v);
        }
      }
    });
  });

  describe("B. Dijkstra / A* Shortest Pathfinding", () => {
    it("should compute optimal corridor path between Engineering and Sales wings", () => {
      const path = officeNavEngine.findShortestPath("engineering_bay", "sales_wing");
      // Engineering -> corridor_north_west -> corridor_center -> corridor_south_east -> sales_wing
      expect(path).toEqual([
        "engineering_bay",
        "corridor_north_west",
        "corridor_center",
        "corridor_south_east",
        "sales_wing",
      ]);
    });

    it("should compute direct corridor path between Executive Suite and Operations Hub", () => {
      const path = officeNavEngine.findShortestPath("executive_suite", "operations_hub");
      expect(path[0]).toBe("executive_suite");
      expect(path[path.length - 1]).toBe("operations_hub");
      expect(path.includes("corridor_north")).toBe(true);
      expect(path.includes("corridor_south")).toBe(true);
    });

    it("should return single node if start and destination are identical", () => {
      const path = officeNavEngine.findShortestPath("corridor_center", "corridor_center");
      expect(path).toEqual(["corridor_center"]);
    });

    it("should correctly find the nearest topology node to arbitrary coordinates", () => {
      // Close to Engineering (-14, 1, -8)
      const nearEng = officeNavEngine.findNearestTopologyNode(-13.5, 1.0, -7.8);
      expect(nearEng).toBe("engineering_bay");

      // Close to Atrium (0, 1, 3)
      const nearCenter = officeNavEngine.findNearestTopologyNode(0.5, 1.0, 2.8);
      expect(nearCenter).toBe("corridor_center");
    });
  });

  describe("C. Waypoint Generation & Workstation Chair Docking", () => {
    it("should generate intermediate corridor waypoints for long cross-office travel", () => {
      const origin: [number, number, number] = [-14.0, 1.0, -8.0]; // Engineering
      const target: [number, number, number] = [14.0, 1.0, 14.0];  // Finance
      const waypoints = officeNavEngine.generateWaypoints(origin, target, "finance_desk_1");

      expect(waypoints.length).toBeGreaterThanOrEqual(4);
      expect(waypoints[0].node_id).toBe("origin");
      expect(waypoints[waypoints.length - 1].node_id).toBe("finance_desk_1");
      expect(waypoints[waypoints.length - 1].cumulative_distance).toBeGreaterThan(30);

      // Distances must be strictly monotonically increasing
      for (let i = 1; i < waypoints.length; i++) {
        expect(waypoints[i].cumulative_distance).toBeGreaterThan(
          waypoints[i - 1].cumulative_distance
        );
      }
    });

    it("should calculate exact chair interaction spot and screen facing angle for workstations", () => {
      const deskX = -12.0;
      const deskY = 1.0;
      const deskZ = -4.0;

      const docking = officeNavEngine.computeWorkstationDocking(deskX, deskY, deskZ);
      expect(docking.chairPosition).toEqual([
        deskX,
        deskY,
        deskZ + WORKSTATION_CHAIR_OFFSET_Z,
      ]);
      expect(docking.facingHeading).toBeCloseTo(WORKSTATION_SCREEN_FACING_YAW, 4);
    });
  });
});
