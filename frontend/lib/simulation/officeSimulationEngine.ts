/**
 * AGENT CITY — Real-time Office Employee Simulation Engine
 *
 * Implements an ultra-lightweight deterministic finite-state machine (FSM)
 * supporting hundreds of independent AI employees with waypoint navigation,
 * collision avoidance, procedural typing, and realistic peer-to-peer conversations.
 */

export type SimulationAgentState =
  | "IDLE"
  | "WORKING"
  | "TYPING"
  | "STANDING"
  | "WALKING"
  | "APPROACHING_AGENT"
  | "CONVERSING"
  | "RETURNING_TO_DESK"
  | "SITTING"
  | "MEETING"
  | "PAUSED";

export interface Waypoint {
  id: string;
  x: number;
  y: number;
  z: number;
  neighbors: string[];
}

export interface FloorNavigationGraph {
  floor: number;
  elevation: number;
  waypoints: Record<string, Waypoint>;
  walkableBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export interface SimulatedAgentData {
  id: string;
  name: string;
  department: string;
  floor: number;
  state: SimulationAgentState;
  stateTimer: number;
  position: [number, number, number];
  targetPosition: [number, number, number] | null;
  heading: number;
  targetHeading: number;
  isSeated: boolean;
  assignedDeskPos: [number, number, number] | null;
  assignedDeskHeading: number;
  interactionPartnerId: string | null;
  path: [number, number, number][];
  pathIndex: number;
  speed: number;
  phaseOffset: number;
  torsoLean: number;
  leftArmAngle: number;
  rightArmAngle: number;
  headNodAngle: number;
}

/**
 * Procedurally generates an obstacle-aware waypoint navigation graph for a given floor.
 * Floors measure 36m wide (-18 to +18) by 26m deep (-13 to +13).
 * Walkable corridors keep agents clear of exterior walls, glass curtain walls, and central elevator shaft.
 */
export function buildFloorNavigationGraph(floor: number): FloorNavigationGraph {
  const elevation = (floor - 1) * 6.0 + 0.05;
  const waypoints: Record<string, Waypoint> = {};

  const addWaypoint = (id: string, x: number, z: number, neighbors: string[]) => {
    waypoints[id] = { id, x, y: elevation, z, neighbors };
  };

  // Main East-West Thoroughfare Corridors
  addWaypoint("w_center_mid", 0, 0, ["w_west_mid", "w_east_mid", "w_front_mid", "w_rear_mid"]);
  addWaypoint("w_west_mid", -8, 0, ["w_center_mid", "w_west_far", "w_west_front", "w_west_rear"]);
  addWaypoint("w_west_far", -14, 0, ["w_west_mid", "w_west_breakout"]);
  addWaypoint("w_east_mid", 8, 0, ["w_center_mid", "w_east_far", "w_east_front", "w_east_rear"]);
  addWaypoint("w_east_far", 14, 0, ["w_east_mid", "w_east_breakout"]);

  // Front Aisle (+Z towards front glass balustrade)
  addWaypoint("w_front_mid", 0, 5.5, ["w_center_mid", "w_west_front", "w_east_front"]);
  addWaypoint("w_west_front", -8, 5.5, ["w_front_mid", "w_west_mid", "w_west_lounge"]);
  addWaypoint("w_east_front", 8, 5.5, ["w_front_mid", "w_east_mid", "w_east_lounge"]);

  // Rear Aisle (-Z towards core and executive wings)
  addWaypoint("w_rear_mid", 0, -4.5, ["w_center_mid", "w_west_rear", "w_east_rear"]);
  addWaypoint("w_west_rear", -8, -4.5, ["w_rear_mid", "w_west_mid", "w_west_desks"]);
  addWaypoint("w_east_rear", 8, -4.5, ["w_rear_mid", "w_east_mid", "w_east_desks"]);

  // Department Breakouts & Lounges
  addWaypoint("w_west_breakout", -14, 3.5, ["w_west_far"]);
  addWaypoint("w_east_breakout", 14, 3.5, ["w_east_far"]);
  addWaypoint("w_west_lounge", -10, 6.5, ["w_west_front"]);
  addWaypoint("w_east_lounge", 10, 6.5, ["w_east_front"]);
  addWaypoint("w_west_desks", -10, -3.5, ["w_west_rear"]);
  addWaypoint("w_east_desks", 10, -3.5, ["w_east_rear"]);

  return {
    floor,
    elevation,
    waypoints,
    walkableBounds: {
      minX: -16.0,
      maxX: 16.0,
      minZ: -8.0,
      maxZ: 9.5,
    },
  };
}

/**
 * A* Pathfinding across waypoints
 */
export function findPathOnFloor(
  graph: FloorNavigationGraph,
  startPos: [number, number, number],
  destPos: [number, number, number]
): [number, number, number][] {
  const wps = graph.waypoints;

  // Find nearest start and end waypoints
  let closestStart: Waypoint | null = null;
  let minDistStart = Infinity;
  let closestEnd: Waypoint | null = null;
  let minDistEnd = Infinity;

  for (const wp of Object.values(wps)) {
    const ds = Math.hypot(wp.x - startPos[0], wp.z - startPos[2]);
    if (ds < minDistStart) {
      minDistStart = ds;
      closestStart = wp;
    }
    const de = Math.hypot(wp.x - destPos[0], wp.z - destPos[2]);
    if (de < minDistEnd) {
      minDistEnd = de;
      closestEnd = wp;
    }
  }

  if (!closestStart || !closestEnd) {
    return [startPos, destPos];
  }

  const startWp: Waypoint = closestStart;
  const endWp: Waypoint = closestEnd;

  if (startWp.id === endWp.id) {
    return [startPos, [startWp.x, graph.elevation, startWp.z], destPos];
  }

  // Dijkstra / BFS search
  const queue: string[] = [startWp.id];
  const cameFrom: Record<string, string | null> = { [startWp.id]: null };
  const costSoFar: Record<string, number> = { [startWp.id]: 0 };

  while (queue.length > 0) {
    // Pop lowest cost
    queue.sort((a, b) => (costSoFar[a] || 0) - (costSoFar[b] || 0));
    const currentId = queue.shift()!;

    if (currentId === endWp.id) break;

    const currentWp = wps[currentId];
    if (!currentWp) continue;

    for (const neighborId of currentWp.neighbors) {
      const neighbor = wps[neighborId];
      if (!neighbor) continue;

      const newCost = costSoFar[currentId] + Math.hypot(neighbor.x - currentWp.x, neighbor.z - currentWp.z);
      if (costSoFar[neighborId] === undefined || newCost < costSoFar[neighborId]) {
        costSoFar[neighborId] = newCost;
        cameFrom[neighborId] = currentId;
        queue.push(neighborId);
      }
    }
  }

  // Reconstruct path
  const path: [number, number, number][] = [];
  let curr: string | null = endWp.id;

  if (curr && cameFrom[curr] === undefined && curr !== startWp.id) {
    // No route found, return direct smoothed path
    return [startPos, destPos];
  }

  while (curr) {
    const wp = wps[curr];
    if (wp) {
      path.unshift([wp.x, graph.elevation, wp.z]);
    }
    curr = cameFrom[curr] ?? null;
  }

  path.unshift(startPos);
  path.push(destPos);
  return path;
}

export class OfficeSimulationEngine {
  private agents: Map<string, SimulatedAgentData> = new Map();
  private floorGraphs: Map<number, FloorNavigationGraph> = new Map();
  private occupiedDeskReservations: Set<string> = new Set();
  private lastUpdateTime: number = 0;
  private isSimulationPaused: boolean = false;

  constructor() {
    for (let f = 1; f <= 6; f++) {
      this.floorGraphs.set(f, buildFloorNavigationGraph(f));
    }
  }

  /**
   * Registers or updates an agent in the simulation engine.
   */
  public registerAgent(
    id: string,
    name: string,
    department: string,
    floor: number,
    initialPos: [number, number, number],
    assignedDeskPos: [number, number, number] | null = null,
    initialState: SimulationAgentState = "WORKING"
  ): void {
    const existing = this.agents.get(id);
    const phaseOffset = existing ? existing.phaseOffset : (this.agents.size + 1) * 0.618;

    const agent: SimulatedAgentData = {
      id,
      name,
      department,
      floor,
      state: existing ? existing.state : initialState,
      stateTimer: existing ? existing.stateTimer : 5 + (phaseOffset % 12),
      position: existing ? existing.position : [...initialPos],
      targetPosition: existing ? existing.targetPosition : null,
      heading: existing ? existing.heading : Math.PI,
      targetHeading: existing ? existing.targetHeading : Math.PI,
      isSeated: existing ? existing.isSeated : (initialState === "WORKING" || initialState === "TYPING" || initialState === "SITTING"),
      assignedDeskPos: assignedDeskPos ? [...assignedDeskPos] : (existing?.assignedDeskPos || null),
      assignedDeskHeading: Math.PI,
      interactionPartnerId: existing ? existing.interactionPartnerId : null,
      path: existing ? existing.path : [],
      pathIndex: 0,
      speed: 2.2, // ~2.2 m/s natural walking pace
      phaseOffset,
      torsoLean: 0.1,
      leftArmAngle: 0.85,
      rightArmAngle: 0.85,
      headNodAngle: 0,
    };

    this.agents.set(id, agent);
  }

  public setPaused(paused: boolean): void {
    this.isSimulationPaused = paused;
  }

  public getAgent(id: string): SimulatedAgentData | undefined {
    return this.agents.get(id);
  }

  public getAllAgents(): SimulatedAgentData[] {
    return Array.from(this.agents.values());
  }

  /**
   * Centralized simulation update loop.
   * Clamps delta to avoid unbounded work spikes after browser tab suspension.
   */
  public update(rawDelta: number): void {
    if (this.isSimulationPaused) return;

    // Strict delta time clamp [0, 0.1s]
    const dt = Math.max(0.001, Math.min(0.1, rawDelta));
    this.lastUpdateTime += dt;

    const agentList = Array.from(this.agents.values());

    for (let i = 0; i < agentList.length; i++) {
      const agent = agentList[i];
      this.updateAgentFSM(agent, dt, agentList);
    }
  }

  private updateAgentFSM(
    agent: SimulatedAgentData,
    dt: number,
    allAgents: SimulatedAgentData[]
  ): void {
    agent.stateTimer -= dt;

    switch (agent.state) {
      case "WORKING":
      case "TYPING": {
        agent.isSeated = true;
        agent.torsoLean = 0.12; // Slight forward focus towards monitor
        // Procedural typing arm oscillation
        const t = this.lastUpdateTime * 14.0 + agent.phaseOffset;
        agent.leftArmAngle = 0.85 + Math.sin(t) * 0.08;
        agent.rightArmAngle = 0.85 + Math.cos(t) * 0.08;
        agent.headNodAngle = Math.sin(t * 0.25) * 0.04;

        // Transition: After 15–35s of work, stand up to walk or visit a peer
        if (agent.stateTimer <= 0) {
          // Switch between TYPING and WORKING, or STANDING up to take a walk
          if (agent.state === "WORKING") {
            agent.state = "TYPING";
            agent.stateTimer = 10 + (agent.phaseOffset % 10);
          } else {
            agent.state = "STANDING";
            agent.stateTimer = 1.2;
            agent.isSeated = false;
          }
        }
        break;
      }

      case "STANDING": {
        agent.isSeated = false;
        agent.torsoLean = 0.0;
        agent.leftArmAngle = 0.0;
        agent.rightArmAngle = 0.0;

        if (agent.stateTimer <= 0) {
          // Choose to approach a colleague on the same floor, or take a corridor stroll
          const peers = allAgents.filter(
            (p) => p.id !== agent.id && p.floor === agent.floor && p.state !== "MEETING"
          );

          if (peers.length > 0 && (agent.phaseOffset % 3 < 2)) {
            // Pick a random colleague to converse with
            const targetPeer = peers[Math.floor(agent.phaseOffset) % peers.length];
            agent.interactionPartnerId = targetPeer.id;
            agent.state = "APPROACHING_AGENT";

            // Find destination near peer
            const graph = this.floorGraphs.get(agent.floor);
            if (graph) {
              const destX = targetPeer.position[0] + (targetPeer.position[0] > 0 ? -1.4 : 1.4);
              const destZ = targetPeer.position[2] + 0.5;
              agent.path = findPathOnFloor(graph, agent.position, [destX, graph.elevation, destZ]);
              agent.pathIndex = 0;
            }
          } else {
            // General corridor walk
            agent.state = "WALKING";
            const graph = this.floorGraphs.get(agent.floor);
            if (graph) {
              const randomWp = Object.values(graph.waypoints)[
                Math.floor((agent.phaseOffset * 7) % Object.keys(graph.waypoints).length)
              ];
              if (randomWp) {
                agent.path = findPathOnFloor(graph, agent.position, [randomWp.x, graph.elevation, randomWp.z]);
                agent.pathIndex = 0;
              }
            }
          }
        }
        break;
      }

      case "WALKING":
      case "APPROACHING_AGENT":
      case "RETURNING_TO_DESK": {
        this.stepAgentWalking(agent, dt, allAgents);
        break;
      }

      case "CONVERSING": {
        agent.isSeated = false;
        agent.torsoLean = 0.02;

        // Turn towards conversation partner
        if (agent.interactionPartnerId) {
          const partner = this.agents.get(agent.interactionPartnerId);
          if (partner) {
            const dx = partner.position[0] - agent.position[0];
            const dz = partner.position[2] - agent.position[2];
            agent.targetHeading = Math.atan2(dx, dz);
          }
        }

        // Smooth heading adjustment
        agent.heading = this.lerpAngle(agent.heading, agent.targetHeading, dt * 6.0);

        // Conversational gesticulation
        const t = this.lastUpdateTime * 3.5 + agent.phaseOffset;
        agent.leftArmAngle = 0.35 + Math.sin(t) * 0.25;
        agent.rightArmAngle = 0.2 + Math.cos(t * 1.2) * 0.2;
        agent.headNodAngle = Math.sin(t * 2.0) * 0.08;

        // After conversation duration (8–18s), return to desk
        if (agent.stateTimer <= 0) {
          agent.interactionPartnerId = null;
          agent.state = "RETURNING_TO_DESK";
          const graph = this.floorGraphs.get(agent.floor);
          if (graph && agent.assignedDeskPos) {
            agent.path = findPathOnFloor(graph, agent.position, agent.assignedDeskPos);
            agent.pathIndex = 0;
          } else {
            agent.state = "SITTING";
            agent.stateTimer = 1.0;
          }
        }
        break;
      }

      case "SITTING": {
        agent.isSeated = true;
        agent.torsoLean = 0.08;
        if (agent.assignedDeskHeading !== undefined) {
          agent.heading = this.lerpAngle(agent.heading, agent.assignedDeskHeading, dt * 8.0);
        }
        if (agent.stateTimer <= 0) {
          agent.state = "WORKING";
          agent.stateTimer = 18 + (agent.phaseOffset % 15);
        }
        break;
      }

      case "MEETING":
      case "PAUSED":
      case "IDLE":
      default: {
        // Keep posture clean
        break;
      }
    }
  }

  private stepAgentWalking(
    agent: SimulatedAgentData,
    dt: number,
    allAgents: SimulatedAgentData[]
  ): void {
    if (!agent.path || agent.path.length === 0 || agent.pathIndex >= agent.path.length) {
      // Reached destination
      if (agent.state === "APPROACHING_AGENT") {
        agent.state = "CONVERSING";
        agent.stateTimer = 10 + (agent.phaseOffset % 8);
        if (agent.interactionPartnerId) {
          const partner = this.agents.get(agent.interactionPartnerId);
          if (partner && partner.state !== "MEETING") {
            partner.state = "CONVERSING";
            partner.stateTimer = agent.stateTimer;
            partner.interactionPartnerId = agent.id;
          }
        }
      } else if (agent.state === "RETURNING_TO_DESK") {
        agent.state = "SITTING";
        agent.stateTimer = 1.2;
      } else {
        // Wandering completed, return home
        agent.state = "RETURNING_TO_DESK";
        const graph = this.floorGraphs.get(agent.floor);
        if (graph && agent.assignedDeskPos) {
          agent.path = findPathOnFloor(graph, agent.position, agent.assignedDeskPos);
          agent.pathIndex = 0;
        } else {
          agent.state = "SITTING";
          agent.stateTimer = 1.0;
        }
      }
      return;
    }

    const nextWp = agent.path[agent.pathIndex];
    const dx = nextWp[0] - agent.position[0];
    const dz = nextWp[2] - agent.position[2];
    const dist = Math.hypot(dx, dz);

    if (dist < 0.25) {
      agent.pathIndex += 1;
      return;
    }

    // Direction and heading
    const desiredHeading = Math.atan2(dx, dz);
    agent.targetHeading = desiredHeading;
    agent.heading = this.lerpAngle(agent.heading, desiredHeading, dt * 8.0);

    // Collision avoidance with other moving agents
    let avoidX = 0;
    let avoidZ = 0;
    for (let j = 0; j < allAgents.length; j++) {
      const other = allAgents[j];
      if (other.id === agent.id || other.floor !== agent.floor) continue;

      const sepX = agent.position[0] - other.position[0];
      const sepZ = agent.position[2] - other.position[2];
      const sepDist = Math.hypot(sepX, sepZ);

      if (sepDist < 0.9 && sepDist > 0.01) {
        // Gentle repulsion
        const factor = (0.9 - sepDist) / 0.9;
        avoidX += (sepX / sepDist) * factor * 0.8;
        avoidZ += (sepZ / sepDist) * factor * 0.8;
      }
    }

    // Move forward
    const moveDist = agent.speed * dt;
    const nx = (dx / dist) * moveDist + avoidX * dt;
    const nz = (dz / dist) * moveDist + avoidZ * dt;

    agent.position[0] += nx;
    agent.position[2] += nz;

    // Natural arm swing and vertical bounce during walk
    const walkCycle = this.lastUpdateTime * 9.0 + agent.phaseOffset;
    agent.leftArmAngle = Math.sin(walkCycle) * 0.45;
    agent.rightArmAngle = -Math.sin(walkCycle) * 0.45;
  }

  private lerpAngle(current: number, target: number, t: number): number {
    let diff = (target - current) % (Math.PI * 2);
    if (diff < -Math.PI) diff += Math.PI * 2;
    if (diff > Math.PI) diff -= Math.PI * 2;
    return current + diff * Math.min(1, Math.max(0, t));
  }
}

// Global simulation engine singleton
export const officeSimulationEngine = new OfficeSimulationEngine();

