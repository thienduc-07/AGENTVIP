/**
 * AGENT CITY 5.0 — Real-time Chibi Office Employee Simulation Engine
 *
 * Implements an ultra-lightweight deterministic finite-state machine (FSM)
 * supporting hundreds of independent AI employees with waypoint navigation,
 * collision avoidance, procedural typing, realistic peer conversations,
 * and precise workstation chair positioning.
 */

export type SimulationAgentState =
  | "IDLE"
  | "WALKING"
  | "RUNNING"
  | "STANDING"
  | "SITTING"
  | "WORKING"
  | "TYPING"
  | "READING"
  | "THINKING"
  | "TALKING"
  | "MEETING"
  | "PRESENTING"
  | "USING_COMPUTER"
  | "DRINKING"
  | "RESTING"
  | "CELEBRATING"
  | "WAITING"
  | "APPROVAL_REQUESTED"
  | "APPROACHING_AGENT"
  | "CONVERSING"
  | "RETURNING_TO_DESK"
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

export interface ChibiStyle {
  skinColor: string;
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
  shoeColor: string;
  outfit: "suit" | "hoodie" | "shirt";
  eyeColor: string;
  hairStyle: "short" | "parted" | "bun" | "curly";
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
  assignedChairPos: [number, number, number] | null;
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
  chibiStyle: ChibiStyle;
  blinkTimer: number;
  isBlinking: boolean;
}

const CHIBI_SKIN_PALETTE = ["#fcd34d", "#fde68a", "#fed7aa", "#fbcfe8", "#f5d0b5", "#e7be9d"];
const CHIBI_HAIR_PALETTE = ["#171717", "#3b2618", "#451a03", "#78350f", "#292524", "#4a2810"];
const CHIBI_PANTS_PALETTE = ["#1e293b", "#0f172a", "#334155", "#18181b"];

export function generateChibiStyle(id: string, department: string): ChibiStyle {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const posHash = Math.abs(hash);

  const skinColor = CHIBI_SKIN_PALETTE[posHash % CHIBI_SKIN_PALETTE.length];
  const hairColor = CHIBI_HAIR_PALETTE[(posHash >> 2) % CHIBI_HAIR_PALETTE.length];
  const pantsColor = CHIBI_PANTS_PALETTE[(posHash >> 4) % CHIBI_PANTS_PALETTE.length];

  // Department-aligned primary shirt/top color
  let shirtColor = "#3b82f6";
  const d = department.toLowerCase();
  if (d.includes("exec") || d.includes("ceo")) shirtColor = "#d97706";
  else if (d.includes("eng") || d.includes("tech") || d.includes("dev")) shirtColor = "#10b981";
  else if (d.includes("ai") || d.includes("data") || d.includes("research")) shirtColor = "#8b5cf6";
  else if (d.includes("market") || d.includes("creative") || d.includes("growth")) shirtColor = "#ec4899";
  else if (d.includes("fin") || d.includes("money")) shirtColor = "#0284c7";
  else if (d.includes("ops") || d.includes("hr")) shirtColor = "#6366f1";
  else if (d.includes("sales")) shirtColor = "#f59e0b";

  const outfits: Array<"suit" | "hoodie" | "shirt"> = ["suit", "hoodie", "shirt"];
  const outfit = d.includes("exec") ? "suit" : outfits[posHash % outfits.length];

  const hairStyles: Array<"short" | "parted" | "bun" | "curly"> = ["short", "parted", "bun", "curly"];
  const hairStyle = hairStyles[(posHash >> 3) % hairStyles.length];

  return {
    skinColor,
    hairColor,
    shirtColor,
    pantsColor,
    shoeColor: "#090d16",
    outfit,
    eyeColor: "#1e1612",
    hairStyle,
  };
}

/**
 * Procedurally generates an obstacle-aware waypoint navigation graph for a given floor.
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

  // Department Breakouts, Library & Lounges
  addWaypoint("w_west_breakout", -14, 3.5, ["w_west_far"]);
  addWaypoint("w_east_breakout", 14, 3.5, ["w_east_far"]);
  addWaypoint("w_west_lounge", -10, 6.5, ["w_west_front"]);
  addWaypoint("w_east_lounge", 10, 6.5, ["w_east_front"]);
  addWaypoint("w_west_desks", -10, -3.5, ["w_west_rear"]);
  addWaypoint("w_east_desks", 10, -3.5, ["w_east_rear"]);
  addWaypoint("w_elevator_door", -10.5, 6.0, ["w_west_front", "w_west_lounge"]);

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

  const queue: string[] = [startWp.id];
  const cameFrom: Record<string, string | null> = { [startWp.id]: null };

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (currentId === endWp.id) break;

    const currentWp = wps[currentId];
    if (!currentWp) continue;

    for (const neighborId of currentWp.neighbors) {
      if (cameFrom[neighborId] === undefined) {
        cameFrom[neighborId] = currentId;
        queue.push(neighborId);
      }
    }
  }

  const pathWaypoints: [number, number, number][] = [];
  let curr: string | null = endWp.id;

  if (cameFrom[endWp.id] !== undefined) {
    while (curr) {
      const wp = wps[curr];
      if (wp) {
        pathWaypoints.unshift([wp.x, graph.elevation, wp.z]);
      }
      curr = cameFrom[curr] ?? null;
    }
  }

  if (pathWaypoints.length === 0) {
    return [startPos, [startWp.x, graph.elevation, startWp.z], [endWp.x, graph.elevation, endWp.z], destPos];
  }

  return [startPos, ...pathWaypoints, destPos];
}

export class OfficeSimulationEngine {
  private agents: Map<string, SimulatedAgentData> = new Map();
  private floorGraphs: Map<number, FloorNavigationGraph> = new Map();
  private lastUpdateTime: number = 0;

  constructor() {
    for (let f = -1; f <= 6; f++) {
      if (f !== 0) {
        this.floorGraphs.set(f, buildFloorNavigationGraph(f));
      }
    }
  }

  public registerAgent(
    id: string,
    name: string,
    department: string,
    floor: number,
    initialPos: [number, number, number],
    assignedDeskPos: [number, number, number] | null,
    initialState: SimulationAgentState = "WORKING"
  ): void {
    if (this.agents.has(id)) {
      const existing = this.agents.get(id)!;
      existing.name = name;
      existing.department = department;
      existing.floor = floor;
      if (assignedDeskPos) {
        existing.assignedDeskPos = [...assignedDeskPos];
        // Exact chair position: offset +0.55m in Z from desk center
        existing.assignedChairPos = [assignedDeskPos[0], assignedDeskPos[1], assignedDeskPos[2] + 0.55];
      }
      return;
    }

    const phaseOffset = (initialPos[0] * 3.14 + initialPos[2] * 2.71) % 10.0;
    const chairPos: [number, number, number] | null = assignedDeskPos
      ? [assignedDeskPos[0], assignedDeskPos[1], assignedDeskPos[2] + 0.55]
      : null;

    const spawnPos: [number, number, number] = chairPos
      ? [...chairPos]
      : [...initialPos];

    const chibiStyle = generateChibiStyle(id, department);

    this.agents.set(id, {
      id,
      name,
      department,
      floor,
      state: initialState,
      stateTimer: 8 + (Math.abs(phaseOffset) % 12),
      position: spawnPos,
      targetPosition: null,
      heading: Math.PI,
      targetHeading: Math.PI,
      isSeated:
        initialState === "WORKING" ||
        initialState === "SITTING" ||
        initialState === "TYPING" ||
        initialState === "DRINKING" ||
        initialState === "READING" ||
        initialState === "USING_COMPUTER",
      assignedDeskPos: assignedDeskPos ? [...assignedDeskPos] : null,
      assignedChairPos: chairPos,
      assignedDeskHeading: Math.PI,
      interactionPartnerId: null,
      path: [],
      pathIndex: 0,
      speed: 1.4,
      phaseOffset,
      torsoLean: initialState === "WORKING" || initialState === "TYPING" ? 0.08 : 0.05,
      leftArmAngle: 0,
      rightArmAngle: 0,
      headNodAngle: 0,
      chibiStyle,
      blinkTimer: 2.0 + (Math.abs(phaseOffset) % 3.0),
      isBlinking: false,
    });
  }

  public getAgent(id: string): SimulatedAgentData | undefined {
    return this.agents.get(id);
  }

  public getAllAgents(): SimulatedAgentData[] {
    return Array.from(this.agents.values());
  }

  public update(timeOrDelta: number, maybeDelta?: number): void {
    let time: number;
    let dt: number;

    if (maybeDelta !== undefined) {
      time = timeOrDelta;
      dt = Math.min(maybeDelta, 0.1);
      this.lastUpdateTime = time;
    } else {
      dt = Math.min(timeOrDelta, 0.1);
      this.lastUpdateTime += dt;
      time = this.lastUpdateTime;
    }

    const agentList = Array.from(this.agents.values());

    for (let i = 0; i < agentList.length; i++) {
      const agent = agentList[i];
      this.updateAgentState(agent, dt, time, agentList);
    }
  }

  private updateAgentState(
    agent: SimulatedAgentData,
    dt: number,
    time: number,
    allAgents: SimulatedAgentData[]
  ): void {
    agent.stateTimer -= dt;

    // Blinking eye simulation
    agent.blinkTimer -= dt;
    if (agent.blinkTimer <= 0) {
      agent.isBlinking = !agent.isBlinking;
      agent.blinkTimer = agent.isBlinking ? 0.15 : 2.5 + (Math.abs(agent.phaseOffset) % 3.5);
    }

    switch (agent.state) {
      case "WORKING":
      case "TYPING":
      case "USING_COMPUTER": {
        agent.isSeated = true;
        agent.torsoLean = 0.12;

        // Ensure agent remains strictly anchored at the chair position facing the desk
        if (agent.assignedChairPos) {
          agent.position[0] = agent.assignedChairPos[0];
          agent.position[2] = agent.assignedChairPos[2];
          agent.heading = Math.PI;
        }

        // Procedural typing finger & arm movement
        const t = time * 16.0 + agent.phaseOffset;
        agent.leftArmAngle = 0.85 + Math.sin(t) * 0.04;
        agent.rightArmAngle = 0.85 + Math.cos(t * 0.9) * 0.04;
        agent.headNodAngle = 0.15 + Math.sin(time * 2.0) * 0.02;

        if (agent.stateTimer <= 0) {
          const roll = Math.random();
          if (roll < 0.25) {
            // Take a coffee or relaxation break
            agent.state = "DRINKING";
            agent.stateTimer = 6.0;
          } else if (roll < 0.45) {
            // Stand up to visit a colleague or library
            agent.state = "STANDING";
            agent.stateTimer = 1.5;
          } else {
            // Continue working
            agent.state = "WORKING";
            agent.stateTimer = 12 + (agent.phaseOffset % 10);
          }
        }
        break;
      }

      case "DRINKING": {
        agent.isSeated = true;
        // Raise right arm holding mug
        agent.rightArmAngle = 1.6 + Math.sin(time * 2.5) * 0.08;
        agent.leftArmAngle = 0.3;
        agent.headNodAngle = -0.08;

        if (agent.stateTimer <= 0) {
          agent.state = "WORKING";
          agent.stateTimer = 15.0;
        }
        break;
      }

      case "READING": {
        agent.isSeated = true;
        // Look down at document or tablet
        agent.headNodAngle = 0.35;
        agent.leftArmAngle = 0.55;
        agent.rightArmAngle = 0.55;

        if (agent.stateTimer <= 0) {
          agent.state = "WORKING";
          agent.stateTimer = 12.0;
        }
        break;
      }

      case "CELEBRATING": {
        // Joyful jumping and hands raised high
        agent.isSeated = false;
        agent.leftArmAngle = -1.6 + Math.sin(time * 8.0) * 0.2;
        agent.rightArmAngle = -1.6 + Math.cos(time * 8.0) * 0.2;
        agent.headNodAngle = -0.2;

        if (agent.stateTimer <= 0) {
          agent.state = "RETURNING_TO_DESK";
        }
        break;
      }

      case "APPROVAL_REQUESTED":
      case "WAITING": {
        // Paused in thought or waiting for user confirmation
        agent.torsoLean = 0.04;
        agent.rightArmAngle = 0.9;
        agent.leftArmAngle = 0.1;
        agent.headNodAngle = Math.sin(time * 1.5) * 0.1;
        break;
      }

      case "STANDING": {
        agent.isSeated = false;
        agent.torsoLean = 0.02;
        agent.leftArmAngle = 0.1;
        agent.rightArmAngle = 0.1;

        if (agent.stateTimer <= 0) {
          const roll = Math.random();
          if (roll < 0.5) {
            // Find nearby colleague on the same floor to chat
            const peers = allAgents.filter(
              (a) => a.id !== agent.id && a.floor === agent.floor && a.state !== "MEETING"
            );
            if (peers.length > 0) {
              const targetPeer = peers[Math.floor(Math.random() * peers.length)];
              agent.state = "APPROACHING_AGENT";
              agent.interactionPartnerId = targetPeer.id;

              const graph = this.floorGraphs.get(agent.floor);
              if (graph) {
                const destX = targetPeer.position[0] + 0.8;
                const destZ = targetPeer.position[2] + 0.8;
                agent.path = findPathOnFloor(graph, agent.position, [destX, graph.elevation, destZ]);
                agent.pathIndex = 0;
              }
            }
          } else {
            // Walk along corridor
            agent.state = "WALKING";
            const graph = this.floorGraphs.get(agent.floor);
            if (graph) {
              const wps = Object.values(graph.waypoints);
              const randomWp = wps[Math.floor((Math.abs(agent.phaseOffset) * 7) % wps.length)];
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
      case "RUNNING":
      case "APPROACHING_AGENT":
      case "RETURNING_TO_DESK": {
        this.stepAgentWalking(agent, dt, allAgents);
        break;
      }

      case "CONVERSING":
      case "TALKING": {
        agent.isSeated = false;
        agent.torsoLean = 0.04;

        if (agent.interactionPartnerId) {
          const partner = this.agents.get(agent.interactionPartnerId);
          if (partner) {
            const dx = partner.position[0] - agent.position[0];
            const dz = partner.position[2] - agent.position[2];
            agent.targetHeading = Math.atan2(dx, dz);
          }
        }

        agent.heading = this.lerpAngle(agent.heading, agent.targetHeading, dt * 6.0);

        const t = time * 3.5 + agent.phaseOffset;
        agent.leftArmAngle = 0.35 + Math.sin(t) * 0.25;
        agent.rightArmAngle = 0.2 + Math.cos(t * 1.2) * 0.2;
        agent.headNodAngle = Math.sin(t * 2.0) * 0.08;

        if (agent.stateTimer <= 0) {
          agent.interactionPartnerId = null;
          agent.state = "RETURNING_TO_DESK";
          const graph = this.floorGraphs.get(agent.floor);
          if (graph && agent.assignedChairPos) {
            agent.path = findPathOnFloor(graph, agent.position, agent.assignedChairPos);
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
        if (agent.assignedChairPos) {
          agent.position[0] = agent.assignedChairPos[0];
          agent.position[2] = agent.assignedChairPos[2];
          agent.heading = Math.PI;
        }
        if (agent.stateTimer <= 0) {
          agent.state = "WORKING";
          agent.stateTimer = 18 + (agent.phaseOffset % 15);
        }
        break;
      }

      case "MEETING":
      case "PRESENTING": {
        agent.headNodAngle = Math.sin(time * 2.0) * 0.08;
        if (agent.state === "PRESENTING") {
          agent.rightArmAngle = -1.2 + Math.sin(time * 2.0) * 0.2;
        }
        break;
      }

      case "PAUSED":
      case "IDLE":
      default: {
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
      if (agent.state === "APPROACHING_AGENT") {
        agent.state = "CONVERSING";
        agent.stateTimer = 8 + (agent.phaseOffset % 6);
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
        agent.stateTimer = 1.0;
        if (agent.assignedChairPos) {
          agent.position[0] = agent.assignedChairPos[0];
          agent.position[2] = agent.assignedChairPos[2];
          agent.heading = Math.PI;
        }
      } else {
        agent.state = "RETURNING_TO_DESK";
        const graph = this.floorGraphs.get(agent.floor);
        if (graph && agent.assignedChairPos) {
          agent.path = findPathOnFloor(graph, agent.position, agent.assignedChairPos);
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

    const desiredHeading = Math.atan2(dx, dz);
    agent.targetHeading = desiredHeading;
    agent.heading = this.lerpAngle(agent.heading, desiredHeading, dt * 8.0);

    // Lateral collision avoidance with other moving agents
    let avoidX = 0;
    let avoidZ = 0;
    for (let j = 0; j < allAgents.length; j++) {
      const other = allAgents[j];
      if (other.id === agent.id || other.floor !== agent.floor) continue;

      const sepX = agent.position[0] - other.position[0];
      const sepZ = agent.position[2] - other.position[2];
      const sepDist = Math.hypot(sepX, sepZ);

      if (sepDist < 0.9 && sepDist > 0.01) {
        const factor = (0.9 - sepDist) / 0.9;
        avoidX += (sepX / sepDist) * factor * 0.8;
        avoidZ += (sepZ / sepDist) * factor * 0.8;
      }
    }

    const moveDist = (agent.state === "RUNNING" ? agent.speed * 1.6 : agent.speed) * dt;
    const nx = (dx / dist) * moveDist + avoidX * dt;
    const nz = (dz / dist) * moveDist + avoidZ * dt;

    agent.position[0] += nx;
    agent.position[2] += nz;

    // Harmonic leg swing and arm counter-swing during walking
    const walkCycle = this.lastUpdateTime * (agent.state === "RUNNING" ? 14.0 : 9.0) + agent.phaseOffset;
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

export const officeSimulationEngine = new OfficeSimulationEngine();
