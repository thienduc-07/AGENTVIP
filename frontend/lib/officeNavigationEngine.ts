/**
 * PROVIPAGENT — Phase 4.2: Integrated Office Navigation Engine
 *
 * Combines authoritative topology graph routing, client-side A* pathfinding,
 * dynamic collision avoidance, workstation chair docking, and multi-agent
 * collaboration formations.
 */

import {
  AgentCharacterData,
  NavigationWaypoint,
  AgentMovementPlan,
  WorldAgentStatus,
} from "../types";
import {
  distance3D,
  computeHeadingRadians,
  lerpAngleRadians,
  WAYPOINT_ARRIVAL_EPSILON,
  DEFAULT_MOVEMENT_SPEED,
  normalizeBehavioralState,
  behavioralToOperationalStatus,
} from "./spatialMovement";
import { SpatialHashGrid } from "./spatialHashGrid";
import {
  CollisionAvoidanceSystem,
  AgentSteeringState,
} from "./collisionAvoidance";

export interface TopologyNode {
  node_id: string;
  label: string;
  node_type: "zone" | "corridor" | "workstation";
  department: string | null;
  x: number;
  y: number;
  z: number;
  neighbors: string[];
}

export const OFFICE_TOPOLOGY_NODES: Record<string, Omit<TopologyNode, "neighbors">> = {
  // Department Zone Hubs
  executive_suite: {
    node_id: "executive_suite",
    label: "Executive Suite (executive_suite)",
    node_type: "zone",
    department: "Executive",
    x: 0.0,
    y: 1.0,
    z: -12.0,
  },
  engineering_bay: {
    node_id: "engineering_bay",
    label: "Engineering (engineering_bay)",
    node_type: "zone",
    department: "Engineering",
    x: -14.0,
    y: 1.0,
    z: -8.0,
  },
  research_lab: {
    node_id: "research_lab",
    label: "AI Research (research_lab)",
    node_type: "zone",
    department: "AI Research",
    x: 14.0,
    y: 1.0,
    z: -8.0,
  },
  marketing_studio: {
    node_id: "marketing_studio",
    label: "Marketing (marketing_studio)",
    node_type: "zone",
    department: "Marketing",
    x: -14.0,
    y: 1.0,
    z: 2.0,
  },
  sales_wing: {
    node_id: "sales_wing",
    label: "Sales (sales_wing)",
    node_type: "zone",
    department: "Sales",
    x: 14.0,
    y: 1.0,
    z: 2.0,
  },
  operations_hub: {
    node_id: "operations_hub",
    label: "Operations (operations_hub)",
    node_type: "zone",
    department: "Operations",
    x: -14.0,
    y: 1.0,
    z: 14.0,
  },
  finance_office: {
    node_id: "finance_office",
    label: "Finance (finance_office)",
    node_type: "zone",
    department: "Finance",
    x: 14.0,
    y: 1.0,
    z: 14.0,
  },
  support_lounge: {
    node_id: "support_lounge",
    label: "Customer Success (support_lounge)",
    node_type: "zone",
    department: "Customer Success",
    x: 0.0,
    y: 1.0,
    z: 8.0,
  },
  // Corridor Spine & Junctions
  corridor_north: {
    node_id: "corridor_north",
    label: "North Executive Corridor",
    node_type: "corridor",
    department: null,
    x: 0.0,
    y: 1.0,
    z: -6.0,
  },
  corridor_north_west: {
    node_id: "corridor_north_west",
    label: "North-West Wing Junction",
    node_type: "corridor",
    department: null,
    x: -7.0,
    y: 1.0,
    z: -4.0,
  },
  corridor_north_east: {
    node_id: "corridor_north_east",
    label: "North-East Wing Junction",
    node_type: "corridor",
    department: null,
    x: 7.0,
    y: 1.0,
    z: -4.0,
  },
  corridor_center: {
    node_id: "corridor_center",
    label: "Central Atrium Hub",
    node_type: "corridor",
    department: null,
    x: 0.0,
    y: 1.0,
    z: 3.0,
  },
  corridor_south_west: {
    node_id: "corridor_south_west",
    label: "South-West Wing Junction",
    node_type: "corridor",
    department: null,
    x: -7.0,
    y: 1.0,
    z: 10.0,
  },
  corridor_south_east: {
    node_id: "corridor_south_east",
    label: "South-East Wing Junction",
    node_type: "corridor",
    department: null,
    x: 7.0,
    y: 1.0,
    z: 10.0,
  },
  corridor_south: {
    node_id: "corridor_south",
    label: "South Operations Corridor",
    node_type: "corridor",
    department: null,
    x: 0.0,
    y: 1.0,
    z: 16.0,
  },
};

export const OFFICE_TOPOLOGY_EDGES: [string, string][] = [
  ["executive_suite", "corridor_north"],
  ["corridor_north", "corridor_north_west"],
  ["corridor_north", "corridor_north_east"],
  ["corridor_north", "corridor_center"],
  ["corridor_north_west", "engineering_bay"],
  ["corridor_north_west", "corridor_center"],
  ["corridor_north_west", "corridor_south_west"],
  ["corridor_north_east", "research_lab"],
  ["corridor_north_east", "corridor_center"],
  ["corridor_north_east", "corridor_south_east"],
  ["corridor_center", "support_lounge"],
  ["corridor_center", "corridor_south_west"],
  ["corridor_center", "corridor_south_east"],
  ["corridor_south_west", "marketing_studio"],
  ["corridor_south_west", "support_lounge"],
  ["corridor_south_west", "corridor_south"],
  ["corridor_south_east", "sales_wing"],
  ["corridor_south_east", "support_lounge"],
  ["corridor_south_east", "corridor_south"],
  ["support_lounge", "corridor_south"],
  ["corridor_south", "operations_hub"],
  ["corridor_south", "finance_office"],
  ["operations_hub", "finance_office"],
];

export const WORKSTATION_CHAIR_OFFSET_Z = 0.65;
export const WORKSTATION_SCREEN_FACING_YAW = Math.PI; // Face -Z into monitors

export class OfficeNavigationEngine {
  private adjacency: Map<string, string[]> = new Map();
  public grid: SpatialHashGrid<AgentSteeringState>;
  public avoidance: CollisionAvoidanceSystem;

  constructor() {
    this.grid = new SpatialHashGrid<AgentSteeringState>(3.5);
    this.avoidance = new CollisionAvoidanceSystem();
    this.buildAdjacency();
  }

  private buildAdjacency(): void {
    this.adjacency.clear();
    for (const nid in OFFICE_TOPOLOGY_NODES) {
      this.adjacency.set(nid, []);
    }
    for (const [u, v] of OFFICE_TOPOLOGY_EDGES) {
      this.adjacency.get(u)?.push(v);
      this.adjacency.get(v)?.push(u);
    }
  }

  /**
   * Finds the nearest topology node ID to a given (x, y, z) position.
   */
  public findNearestTopologyNode(x: number, y: number, z: number): string {
    let bestId = "corridor_center";
    let bestDist = Infinity;

    for (const [nid, node] of Object.entries(OFFICE_TOPOLOGY_NODES)) {
      const d = distance3D([x, y, z], [node.x, node.y, node.z]);
      if (d < bestDist) {
        bestDist = d;
        bestId = nid;
      }
    }
    return bestId;
  }

  /**
   * Computes shortest path between two topology nodes using Dijkstra / A*.
   */
  public findShortestPath(startNodeId: string, endNodeId: string): string[] {
    if (startNodeId === endNodeId) {
      return [startNodeId];
    }

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();

    for (const nid in OFFICE_TOPOLOGY_NODES) {
      dist.set(nid, Infinity);
      prev.set(nid, null);
    }
    dist.set(startNodeId, 0);

    const queue: Array<{ id: string; d: number }> = [{ id: startNodeId, d: 0 }];

    while (queue.length > 0) {
      queue.sort((a, b) => a.d - b.d);
      const { id: u, d: currentDist } = queue.shift()!;

      if (visited.has(u)) continue;
      visited.add(u);

      if (u === endNodeId) break;

      const uNode = OFFICE_TOPOLOGY_NODES[u];
      if (!uNode) continue;

      const neighbors = this.adjacency.get(u) || [];
      for (const v of neighbors) {
        if (visited.has(v)) continue;
        const vNode = OFFICE_TOPOLOGY_NODES[v];
        if (!vNode) continue;

        const weight = distance3D(
          [uNode.x, uNode.y, uNode.z],
          [vNode.x, vNode.y, vNode.z]
        );
        const alt = currentDist + weight;

        if (alt < (dist.get(v) ?? Infinity)) {
          dist.set(v, alt);
          prev.set(v, u);
          queue.push({ id: v, d: alt });
        }
      }
    }

    const path: string[] = [];
    let curr: string | null | undefined = endNodeId;
    while (curr) {
      path.push(curr);
      curr = prev.get(curr);
    }
    path.reverse();

    if (path.length === 0 || path[0] !== startNodeId) {
      return [startNodeId, endNodeId];
    }
    return path;
  }

  /**
   * Generates a waypoint list from origin to target position, routing via topology.
   */
  public generateWaypoints(
    origin: [number, number, number],
    target: [number, number, number],
    destinationId: string = "destination"
  ): NavigationWaypoint[] {
    const directDist = distance3D(origin, target);
    const waypoints: NavigationWaypoint[] = [
      {
        index: 0,
        node_id: "origin",
        label: "Origin",
        x: origin[0],
        y: origin[1],
        z: origin[2],
        segment_distance: 0,
        cumulative_distance: 0,
      },
    ];

    if (directDist > 3.5) {
      const startNode = this.findNearestTopologyNode(origin[0], origin[1], origin[2]);
      const endNode = this.findNearestTopologyNode(target[0], target[1], target[2]);
      const nodePath = this.findShortestPath(startNode, endNode);

      let cumDist = 0;
      for (const nid of nodePath) {
        const ndata = OFFICE_TOPOLOGY_NODES[nid];
        if (!ndata) continue;

        const prev = waypoints[waypoints.length - 1];
        const segDist = distance3D([prev.x, prev.y, prev.z], [ndata.x, ndata.y, ndata.z]);
        if (segDist < 0.2) continue; // Skip redundant waypoint

        cumDist += segDist;
        waypoints.push({
          index: waypoints.length,
          node_id: ndata.node_id,
          label: ndata.label,
          x: ndata.x,
          y: ndata.y,
          z: ndata.z,
          segment_distance: segDist,
          cumulative_distance: cumDist,
        });
      }
    }

    // Final target waypoint
    const prev = waypoints[waypoints.length - 1];
    const segDist = distance3D([prev.x, prev.y, prev.z], target);
    if (segDist > WAYPOINT_ARRIVAL_EPSILON || waypoints.length === 1) {
      waypoints.push({
        index: waypoints.length,
        node_id: destinationId,
        label: destinationId,
        x: target[0],
        y: target[1],
        z: target[2],
        segment_distance: segDist,
        cumulative_distance: prev.cumulative_distance + segDist,
      });
    } else {
      prev.node_id = destinationId;
      prev.label = destinationId;
    }

    return waypoints;
  }

  /**
   * Computes workstation chair docking target and screen-facing angle.
   * Workstations face -Z by default, so chair is placed at (pos_x, pos_z + 0.65).
   */
  public computeWorkstationDocking(
    deskX: number,
    deskY: number,
    deskZ: number
  ): { chairPosition: [number, number, number]; facingHeading: number } {
    return {
      chairPosition: [deskX, deskY, deskZ + WORKSTATION_CHAIR_OFFSET_Z],
      facingHeading: WORKSTATION_SCREEN_FACING_YAW,
    };
  }

  /**
   * Synchronizes active agent states into the spatial hash grid.
   */
  public syncGrid(agents: Record<string, AgentCharacterData>): void {
    for (const [id, agent] of Object.entries(agents)) {
      const priority =
        agent.role.toLowerCase().includes("ceo") || agent.role.toLowerCase().includes("executive")
          ? 100
          : agent.isMoving
          ? 50
          : 10;

      const plan = agent.movementPlan;
      let targetX: number | undefined;
      let targetZ: number | undefined;
      if (plan && plan.waypoints.length > 0) {
        const twp = plan.waypoints[plan.waypoints.length - 1];
        targetX = twp.x;
        targetZ = twp.z;
      }

      const steeringData: AgentSteeringState = {
        id,
        x: agent.position[0],
        z: agent.position[2],
        vx: 0,
        vz: 0,
        radius: 0.5,
        priority,
        targetX,
        targetZ,
      };

      this.grid.insert(id, agent.position[0], agent.position[2], 0.5, steeringData);
    }
  }

  /**
   * Steps an agent along its movement plan with continuous velocity integration,
   * deceleration on arrival, obstacle repulsion, and collision avoidance.
   * Clamps deltaSeconds to a maximum of 0.25s per tick to prevent physics tunneling on frame drops.
   */
  public stepAgent(
    agent: AgentCharacterData,
    deltaSeconds: number,
    allAgents?: Record<string, AgentCharacterData>
  ): AgentCharacterData {
    if (!agent.movementPlan || !agent.isMoving || deltaSeconds <= 0) {
      return agent;
    }

    const dt = Math.min(deltaSeconds, 0.25);
    return this.stepSingleTick(agent, dt);
  }

  private stepSingleTick(
    agent: AgentCharacterData,
    dt: number
  ): AgentCharacterData {
    const plan = agent.movementPlan;
    if (!plan || !agent.isMoving || dt <= 0) {
      return agent;
    }

    let currentPos: [number, number, number] = [...agent.position];
    let wpIndex = Math.max(1, plan.currentWaypointIndex);
    let heading = agent.headingRadians ?? 0;

    if (wpIndex >= plan.waypoints.length) {
      return {
        ...agent,
        position: [...plan.targetPosition],
        isMoving: false,
        movementPlan: {
          ...plan,
          progressRatio: 1,
        },
      };
    }

    const targetWp = plan.waypoints[wpIndex];
    const targetVec: [number, number, number] = [targetWp.x, targetWp.y, targetWp.z];
    const distToWp = distance3D(currentPos, targetVec);

    // If reached intermediate waypoint, advance to next
    if (distToWp <= WAYPOINT_ARRIVAL_EPSILON) {
      wpIndex += 1;
      if (wpIndex >= plan.waypoints.length) {
        // Arrival at final destination
        const isDesk =
          plan.destination.toLowerCase().includes("desk") ||
          plan.destination.toLowerCase().includes("workstation");
        const finalHeading = isDesk ? WORKSTATION_SCREEN_FACING_YAW : heading;

        return {
          ...agent,
          position: [...plan.targetPosition],
          headingRadians: finalHeading,
          isMoving: false,
          movementPlan: {
            ...plan,
            currentWaypointIndex: plan.waypoints.length,
            progressRatio: 1,
          },
        };
      }
    }

    const activeWp = plan.waypoints[wpIndex];
    const activeTarget: [number, number, number] = [activeWp.x, activeWp.y, activeWp.z];
    const distToActive = distance3D(currentPos, activeTarget);

    // Compute desired forward direction
    const dirX = (activeTarget[0] - currentPos[0]) / Math.max(distToActive, 1e-4);
    const dirZ = (activeTarget[2] - currentPos[2]) / Math.max(distToActive, 1e-4);

    // Speed modulation: deceleration within 1.5m of final destination
    const totalRemaining = distance3D(currentPos, plan.targetPosition);
    let effectiveSpeed = plan.speed || DEFAULT_MOVEMENT_SPEED;
    if (totalRemaining < 1.5) {
      effectiveSpeed = Math.max(1.0, effectiveSpeed * (totalRemaining / 1.5));
    }

    const rawVx = dirX * effectiveSpeed;
    const rawVz = dirZ * effectiveSpeed;

    // Apply collision avoidance & dynamic separation forces
    const steeringState: AgentSteeringState = {
      id: agent.id,
      x: currentPos[0],
      z: currentPos[2],
      vx: rawVx,
      vz: rawVz,
      radius: 0.5,
      priority: agent.role.toLowerCase().includes("ceo") ? 100 : 50,
      targetX: plan.targetPosition[0],
      targetZ: plan.targetPosition[2],
    };

    const isArriving = totalRemaining < 1.2;
    const [steeredVx, steeredVz] = this.avoidance.computeSteeringVelocity(
      steeringState,
      this.grid,
      rawVx,
      rawVz,
      isArriving
    );

    // Integrate stepped position
    const stepX = currentPos[0] + steeredVx * dt;
    const stepZ = currentPos[2] + steeredVz * dt;
    const stepY = activeTarget[1]; // Keep planar elevation

    // Update spatial grid
    this.grid.update(agent.id, stepX, stepZ);

    // Compute updated yaw heading
    const desiredHeading = computeHeadingRadians(currentPos, [stepX, stepY, stepZ], heading);
    heading = lerpAngleRadians(heading, desiredHeading, Math.min(1, dt * 10));

    const newPos: [number, number, number] = [stepX, stepY, stepZ];
    const distToTarget = distance3D(newPos, plan.targetPosition);

    if (distToTarget <= WAYPOINT_ARRIVAL_EPSILON) {
      const isDesk =
        plan.destination.toLowerCase().includes("desk") ||
        plan.destination.toLowerCase().includes("workstation");
      const finalHeading = isDesk ? WORKSTATION_SCREEN_FACING_YAW : heading;

      return {
        ...agent,
        position: [...plan.targetPosition],
        headingRadians: finalHeading,
        isMoving: false,
        movementPlan: {
          ...plan,
          currentWaypointIndex: plan.waypoints.length,
          progressRatio: 1,
        },
      };
    }

    const progressRatio = Math.max(
      plan.progressRatio,
      Math.min(1, 1 - distToTarget / Math.max(plan.totalDistance, 1e-4))
    );

    return {
      ...agent,
      position: newPos,
      headingRadians: heading,
      isMoving: true,
      movementPlan: {
        ...plan,
        currentWaypointIndex: wpIndex,
        progressRatio,
      },
    };
  }

  /**
   * Generates a circular meeting formation around a focal point (e.g. Executive Suite or Atrium).
   */
  public generateMeetingFormation(
    agentIds: string[],
    center: [number, number, number] = [0, 1.0, -12.0],
    radius: number = 2.4
  ): Record<string, [number, number, number]> {
    const result: Record<string, [number, number, number]> = {};
    const count = agentIds.length;
    if (count === 0) return result;

    const angleStep = (2 * Math.PI) / count;
    for (let i = 0; i < count; i++) {
      const angle = i * angleStep;
      const x = center[0] + Math.cos(angle) * radius;
      const z = center[2] + Math.sin(angle) * radius;
      result[agentIds[i]] = [round(x, 2), center[1], round(z, 2)];
    }
    return result;
  }
}

function round(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export const officeNavEngine = new OfficeNavigationEngine();
