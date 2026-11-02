/**
 * PROVIPAGENT — Phase 4.2: Real-Time Multi-Agent Collision Avoidance System
 *
 * Implements Reynolds-style dynamic agent separation, lateral corridor evasion,
 * priority right-of-way resolution, and static obstacle AABB collision response.
 */

import { SpatialHashGrid, SpatialGridItem } from "./spatialHashGrid";

export interface StaticObstacleAABB {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  type: "desk" | "wall" | "column" | "restricted";
}

export interface AgentSteeringState {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  priority: number; // Higher number = higher right of way (e.g. CEO=100, active task=50, idle=10)
  targetX?: number;
  targetZ?: number;
}

export interface CollisionAvoidanceConfig {
  agentPersonalRadius: number;
  agentAvoidanceRadius: number;
  separationWeight: number;
  lateralEvasionWeight: number;
  obstacleAvoidanceWeight: number;
  maxSteeringForce: number;
  officeBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export const DEFAULT_AVOIDANCE_CONFIG: CollisionAvoidanceConfig = {
  agentPersonalRadius: 0.5,
  agentAvoidanceRadius: 1.4,
  separationWeight: 2.2,
  lateralEvasionWeight: 1.6,
  obstacleAvoidanceWeight: 3.0,
  maxSteeringForce: 4.5,
  officeBounds: {
    minX: -28.5,
    maxX: 28.5,
    minZ: -25.5,
    maxZ: 25.5,
  },
};

export class CollisionAvoidanceSystem {
  private config: CollisionAvoidanceConfig;
  private staticObstacles: StaticObstacleAABB[] = [];
  private scratchNeighbors: SpatialGridItem<AgentSteeringState>[] = [];

  constructor(config: Partial<CollisionAvoidanceConfig> = {}) {
    this.config = { ...DEFAULT_AVOIDANCE_CONFIG, ...config };
  }

  /**
   * Registers a static obstacle bounding box (desk, architectural wall, pillar).
   */
  public registerObstacle(obstacle: StaticObstacleAABB): void {
    const existingIdx = this.staticObstacles.findIndex((o) => o.id === obstacle.id);
    if (existingIdx !== -1) {
      this.staticObstacles[existingIdx] = obstacle;
    } else {
      this.staticObstacles.push(obstacle);
    }
  }

  /**
   * Clears registered static obstacles.
   */
  public clearObstacles(): void {
    this.staticObstacles = [];
  }

  /**
   * Registers standard office workstation bounding boxes derived from workstation coordinates.
   */
  public registerWorkstations(
    workstations: Array<{ id: string; x: number; z: number; width?: number; depth?: number }>
  ): void {
    for (const ws of workstations) {
      const hw = (ws.width ?? 2.3) / 2;
      const hd = (ws.depth ?? 1.2) / 2;
      this.registerObstacle({
        id: `desk_${ws.id}`,
        minX: ws.x - hw,
        maxX: ws.x + hw,
        minZ: ws.z - hd,
        maxZ: ws.z + hd,
        type: "desk",
      });
    }
  }

  /**
   * Computes dynamic separation and avoidance steering forces for an agent.
   *
   * @param agent Current agent steering state
   * @param grid SpatialHashGrid containing all active agent positions
   * @param desiredVx Desired forward velocity X towards waypoint
   * @param desiredVz Desired forward velocity Z towards waypoint
   * @param isArrivingAtWorkstation If true and docking at own desk, relaxes desk obstacle avoidance
   * @returns [adjustedVx, adjustedVz] adjusted velocity vector
   */
  public computeSteeringVelocity(
    agent: AgentSteeringState,
    grid: SpatialHashGrid<AgentSteeringState>,
    desiredVx: number,
    desiredVz: number,
    isArrivingAtWorkstation: boolean = false
  ): [number, number] {
    let steerX = 0;
    let steerZ = 0;

    const queryRadius = this.config.agentAvoidanceRadius;
    const neighborCount = grid.queryRadiusAllocFree(
      agent.x,
      agent.z,
      queryRadius,
      this.scratchNeighbors
    );

    // 1. Dynamic Agent-to-Agent Separation & Lateral Corridor Evasion
    for (let i = 0; i < neighborCount; i++) {
      const neighbor = this.scratchNeighbors[i];
      if (neighbor.id === agent.id) continue;

      const dx = agent.x - neighbor.x;
      const dz = agent.z - neighbor.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 1e-4) {
        // Coincident position perturbation
        const angle = (parseInt(agent.id.slice(-2), 16) || 1) * 0.1;
        steerX += Math.cos(angle) * this.config.separationWeight;
        steerZ += Math.sin(angle) * this.config.separationWeight;
        continue;
      }

      const minDist = agent.radius + neighbor.radius;
      const combinedRadius = Math.max(minDist, queryRadius);

      if (dist < combinedRadius) {
        // Mutual repulsion magnitude inversely proportional to distance
        const overlap = Math.max(0, combinedRadius - dist);
        const normX = dx / dist;
        const normZ = dz / dist;

        // Priority weighting: lower priority agents yield more strongly
        const priorityFactor =
          neighbor.data.priority > agent.priority ? 1.5 : 0.8;

        const force = (overlap / combinedRadius) * this.config.separationWeight * priorityFactor;
        steerX += normX * force;
        steerZ += normZ * force;

        // Head-on traffic detection (corridor passing convention: yield to right)
        const agentSpeed = Math.sqrt(desiredVx * desiredVx + desiredVz * desiredVz);
        const neighborSpeed = Math.sqrt(
          neighbor.data.vx * neighbor.data.vx + neighbor.data.vz * neighbor.data.vz
        );

        if (agentSpeed > 0.1 && neighborSpeed > 0.1) {
          const dotVel =
            (desiredVx * neighbor.data.vx + desiredVz * neighbor.data.vz) /
            (agentSpeed * neighborSpeed);

          // Opposing paths: dot product < -0.4 (head-on collision course)
          if (dotVel < -0.4) {
            // Perpendicular vector to the right of travel direction: (-Vz, Vx)
            const rightX = -desiredVz / agentSpeed;
            const rightZ = desiredVx / agentSpeed;
            const lateralMagnitude = (1.0 - dist / combinedRadius) * this.config.lateralEvasionWeight;

            steerX += rightX * lateralMagnitude;
            steerZ += rightZ * lateralMagnitude;
          }
        }
      }
    }

    // 2. Static Obstacle AABB Avoidance (Workstations, Columns, Walls)
    for (let i = 0; i < this.staticObstacles.length; i++) {
      const obs = this.staticObstacles[i];

      // If docking at workstation, ignore the destination desk
      if (isArrivingAtWorkstation && obs.type === "desk") {
        const obsCenterX = (obs.minX + obs.maxX) / 2;
        const obsCenterZ = (obs.minZ + obs.maxZ) / 2;
        const distToTarget = Math.hypot(
          (agent.targetX ?? agent.x) - obsCenterX,
          (agent.targetZ ?? agent.z) - obsCenterZ
        );
        if (distToTarget < 1.8) {
          continue;
        }
      }

      // Find closest point on AABB to agent position
      const closestX = Math.max(obs.minX, Math.min(agent.x, obs.maxX));
      const closestZ = Math.max(obs.minZ, Math.min(agent.z, obs.maxZ));

      const dx = agent.x - closestX;
      const dz = agent.z - closestZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const safeMargin = agent.radius + 0.35;

      if (dist < safeMargin) {
        let normX = 0;
        let normZ = 0;

        if (dist > 1e-4) {
          normX = dx / dist;
          normZ = dz / dist;
        } else {
          // Agent center is inside AABB: push out towards nearest edge
          const distLeft = agent.x - obs.minX;
          const distRight = obs.maxX - agent.x;
          const distTop = agent.z - obs.minZ;
          const distBottom = obs.maxZ - agent.z;
          const minEdge = Math.min(distLeft, distRight, distTop, distBottom);

          if (minEdge === distLeft) normX = -1;
          else if (minEdge === distRight) normX = 1;
          else if (minEdge === distTop) normZ = -1;
          else normZ = 1;
        }

        const pushMagnitude =
          Math.max(0.5, safeMargin - dist) * this.config.obstacleAvoidanceWeight;
        steerX += normX * pushMagnitude;
        steerZ += normZ * pushMagnitude;
      }
    }

    // 3. Perimeter Boundary Repulsion (Keep within office walls)
    const bounds = this.config.officeBounds;
    const boundaryBuffer = 1.0;
    if (agent.x < bounds.minX + boundaryBuffer) {
      steerX += (bounds.minX + boundaryBuffer - agent.x) * 3.0;
    } else if (agent.x > bounds.maxX - boundaryBuffer) {
      steerX -= (agent.x - (bounds.maxX - boundaryBuffer)) * 3.0;
    }
    if (agent.z < bounds.minZ + boundaryBuffer) {
      steerZ += (bounds.minZ + boundaryBuffer - agent.z) * 3.0;
    } else if (agent.z > bounds.maxZ - boundaryBuffer) {
      steerZ -= (agent.z - (bounds.maxZ - boundaryBuffer)) * 3.0;
    }

    // 4. Combine Desired Velocity with Steering Force
    let combinedVx = desiredVx + steerX;
    let combinedVz = desiredVz + steerZ;

    // Clamp combined speed to avoid extreme ejection
    const desiredSpeed = Math.sqrt(desiredVx * desiredVx + desiredVz * desiredVz);
    const combinedSpeed = Math.sqrt(combinedVx * combinedVx + combinedVz * combinedVz);
    const maxAllowedSpeed = Math.max(desiredSpeed * 1.35, desiredSpeed);

    if (combinedSpeed > maxAllowedSpeed && combinedSpeed > 1e-4) {
      const scale = maxAllowedSpeed / combinedSpeed;
      combinedVx *= scale;
      combinedVz *= scale;
    }

    return [combinedVx, combinedVz];
  }

  /**
   * Checks if a 2D line segment between p1 and p2 intersects any static obstacle AABB.
   */
  public isSegmentBlocked(
    p1: [number, number],
    p2: [number, number],
    agentRadius: number = 0.5
  ): boolean {
    const minSegX = Math.min(p1[0], p2[0]) - agentRadius;
    const maxSegX = Math.max(p1[0], p2[0]) + agentRadius;
    const minSegZ = Math.min(p1[1], p2[1]) - agentRadius;
    const maxSegZ = Math.max(p1[1], p2[1]) + agentRadius;

    for (const obs of this.staticObstacles) {
      // Fast AABB overlap check
      if (
        maxSegX < obs.minX ||
        minSegX > obs.maxX ||
        maxSegZ < obs.minZ ||
        minSegZ > obs.maxZ
      ) {
        continue;
      }
      return true;
    }
    return false;
  }
}
