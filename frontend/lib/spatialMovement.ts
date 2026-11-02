import {
  AgentBehavioralState,
  AgentCharacterData,
  AgentMovementPlan,
  NavigationWaypoint,
  WorldAgentStatus,
} from "../types";

export const DEFAULT_MOVEMENT_SPEED = 4.0;
export const EMERGENCY_RECOVERY_TELEPORT_DISTANCE = 32.0;
export const WAYPOINT_ARRIVAL_EPSILON = 0.04;

const VALID_BEHAVIORAL_STATES: Set<AgentBehavioralState> = new Set([
  "IDLE",
  "PLANNING",
  "THINKING",
  "WORKING",
  "COMMUNICATING",
  "MOVING",
  "WAITING",
  "COMPLETED",
  "ERROR",
]);

export function normalizeBehavioralState(
  rawState?: string | null,
  fallbackOperationalStatus?: WorldAgentStatus
): AgentBehavioralState {
  if (rawState) {
    const upper = rawState.trim().toUpperCase() as AgentBehavioralState;
    if (VALID_BEHAVIORAL_STATES.has(upper)) {
      return upper;
    }
  }
  switch (fallbackOperationalStatus) {
    case "working":
      return "WORKING";
    case "waiting_approval":
      return "WAITING";
    case "error":
      return "ERROR";
    default:
      return "IDLE";
  }
}

export function behavioralToOperationalStatus(
  behavioralState: AgentBehavioralState,
  currentStatus: WorldAgentStatus = "idle"
): WorldAgentStatus {
  if (currentStatus === "offline" && behavioralState === "IDLE") {
    return "offline";
  }
  switch (behavioralState) {
    case "PLANNING":
    case "THINKING":
    case "WORKING":
    case "COMMUNICATING":
    case "MOVING":
      return "working";
    case "WAITING":
      return "waiting_approval";
    case "ERROR":
      return "error";
    case "IDLE":
    case "COMPLETED":
    default:
      return "idle";
  }
}

export function distance3D(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes yaw heading angle (in radians around the Y axis) facing from `from` toward `to`.
 * In Three.js (+Z forward avatar mesh), atan2(dx, dz) rotates the character toward the target vector.
 */
export function computeHeadingRadians(
  from: [number, number, number],
  to: [number, number, number],
  fallbackHeading: number = 0
): number {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) {
    return fallbackHeading;
  }
  return Math.atan2(dx, dz);
}

/**
 * Shortest-arc angular interpolation between two angles in radians.
 */
export function lerpAngleRadians(
  current: number,
  target: number,
  t: number
): number {
  const clampedT = Math.max(0, Math.min(1, t));
  let diff = ((target - current + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (diff < -Math.PI) {
    diff += 2 * Math.PI;
  }
  return current + diff * clampedT;
}

export function buildLinearWaypoints(
  origin: [number, number, number],
  target: [number, number, number],
  destinationId: string = "destination"
): NavigationWaypoint[] {
  const dist = distance3D(origin, target);
  return [
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
    {
      index: 1,
      node_id: destinationId,
      label: destinationId,
      x: target[0],
      y: target[1],
      z: target[2],
      segment_distance: dist,
      cumulative_distance: dist,
    },
  ];
}

export function parseWaypointsFromPayload(
  rawWaypoints: any[] | undefined,
  origin: [number, number, number],
  target: [number, number, number],
  destinationId: string
): NavigationWaypoint[] {
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length === 0) {
    return buildLinearWaypoints(origin, target, destinationId);
  }

  const parsed: NavigationWaypoint[] = [];
  let cumulative = 0;

  // Always anchor first waypoint to current visual position to avoid teleportation on reroute
  parsed.push({
    index: 0,
    node_id: "current_origin",
    label: "Current Origin",
    x: origin[0],
    y: origin[1],
    z: origin[2],
    segment_distance: 0,
    cumulative_distance: 0,
  });

  for (let i = 0; i < rawWaypoints.length; i++) {
    const wp = rawWaypoints[i];
    if (!wp || typeof wp.x !== "number" || typeof wp.z !== "number") continue;
    const wx = Number(wp.x);
    const wy = typeof wp.y === "number" ? Number(wp.y) : origin[1];
    const wz = Number(wp.z);

    const prev = parsed[parsed.length - 1];
    const seg = distance3D([prev.x, prev.y, prev.z], [wx, wy, wz]);
    if (seg < WAYPOINT_ARRIVAL_EPSILON && i < rawWaypoints.length - 1) {
      continue;
    }
    cumulative += seg;
    parsed.push({
      index: parsed.length,
      node_id: String(wp.node_id || `wp_${parsed.length}`),
      label: String(wp.label || wp.node_id || `Waypoint ${parsed.length}`),
      x: wx,
      y: wy,
      z: wz,
      segment_distance: seg,
      cumulative_distance: cumulative,
    });
  }

  if (parsed.length === 1) {
    const seg = distance3D(origin, target);
    parsed.push({
      index: 1,
      node_id: destinationId,
      label: destinationId,
      x: target[0],
      y: target[1],
      z: target[2],
      segment_distance: seg,
      cumulative_distance: seg,
    });
  }

  return parsed;
}

/**
 * Applies `agent.movement_started` payload to an AgentCharacterData record.
 * Anchors interpolation from the agent's current visual position so destination changes
 * and interruptions never cause instantaneous teleportation.
 */
export function applyMovementStarted(
  agent: AgentCharacterData,
  payload: Record<string, any>,
  nowMs: number = Date.now()
): AgentCharacterData {
  const currentPos: [number, number, number] = [...agent.position];

  const targetObj = payload.target_position || payload.targetPosition || {};
  const tx = typeof targetObj.x === "number" ? targetObj.x : currentPos[0];
  const ty = typeof targetObj.y === "number" ? targetObj.y : currentPos[1];
  const tz = typeof targetObj.z === "number" ? targetObj.z : currentPos[2];
  const targetPosition: [number, number, number] = [tx, ty, tz];

  const destination = String(
    payload.destination || payload.target_destination || agent.station || "destination"
  );
  const movementId = String(payload.movement_id || `mov-${nowMs}`);
  const speed =
    typeof payload.speed === "number" && payload.speed > 0
      ? payload.speed
      : DEFAULT_MOVEMENT_SPEED;

  const waypoints = parseWaypointsFromPayload(
    payload.waypoints,
    currentPos,
    targetPosition,
    destination
  );
  const totalDistance =
    waypoints.length > 0
      ? waypoints[waypoints.length - 1].cumulative_distance
      : distance3D(currentPos, targetPosition);

  const firstTargetWp = waypoints[1] || waypoints[0];
  const headingRadians = computeHeadingRadians(
    currentPos,
    [firstTargetWp.x, firstTargetWp.y, firstTargetWp.z],
    agent.headingRadians ?? 0
  );

  const plan: AgentMovementPlan = {
    movementId,
    origin: currentPos,
    destination,
    targetPosition,
    waypoints,
    currentWaypointIndex: 1,
    speed,
    totalDistance,
    progressRatio: totalDistance <= WAYPOINT_ARRIVAL_EPSILON ? 1 : 0,
    startedAtMs: nowMs,
  };

  const behavioralState = normalizeBehavioralState(
    payload.behavioral_state || "MOVING",
    "working"
  );

  return {
    ...agent,
    behavioralState,
    status: behavioralToOperationalStatus(behavioralState, agent.status),
    targetPosition,
    targetDestination: destination,
    activeMovementId: movementId,
    movementPlan: plan,
    isMoving: totalDistance > WAYPOINT_ARRIVAL_EPSILON,
    headingRadians,
  };
}

/**
 * Applies `agent.movement_progress` payload without snapping/teleporting if smooth
 * local waypoint interpolation is already active for the same movement_id.
 */
export function applyMovementProgress(
  agent: AgentCharacterData,
  payload: Record<string, any>,
  nowMs: number = Date.now()
): AgentCharacterData {
  const movementId = payload.movement_id ? String(payload.movement_id) : null;
  if (
    movementId &&
    agent.activeMovementId &&
    agent.activeMovementId !== movementId
  ) {
    // Ignore stale movement progress from a superseded movement command
    return agent;
  }

  const posObj = payload.position || {};
  const px = typeof posObj.x === "number" ? posObj.x : agent.position[0];
  const py = typeof posObj.y === "number" ? posObj.y : agent.position[1];
  const pz = typeof posObj.z === "number" ? posObj.z : agent.position[2];
  const reportedPos: [number, number, number] = [px, py, pz];

  const drift = distance3D(agent.position, reportedPos);

  // If the agent has no active movementPlan or drifted significantly (> 0.15 units),
  // create/adjust a smooth interpolation segment toward the reported/target position
  if (!agent.movementPlan && drift > WAYPOINT_ARRIVAL_EPSILON) {
    const targetObj = payload.target_position || {};
    const targetPos: [number, number, number] = [
      typeof targetObj.x === "number" ? targetObj.x : reportedPos[0],
      typeof targetObj.y === "number" ? targetObj.y : reportedPos[1],
      typeof targetObj.z === "number" ? targetObj.z : reportedPos[2],
    ];
    return applyMovementStarted(
      agent,
      {
        movement_id: movementId || `mov-prog-${nowMs}`,
        destination: payload.destination || agent.station,
        target_position: { x: targetPos[0], y: targetPos[1], z: targetPos[2] },
        waypoints: [
          { node_id: "reported", x: reportedPos[0], y: reportedPos[1], z: reportedPos[2] },
          { node_id: "target", x: targetPos[0], y: targetPos[1], z: targetPos[2] },
        ],
      },
      nowMs
    );
  }

  if (agent.movementPlan && typeof payload.progress_ratio === "number") {
    return {
      ...agent,
      movementPlan: {
        ...agent.movementPlan,
        progressRatio: Math.max(
          agent.movementPlan.progressRatio,
          Math.min(1, payload.progress_ratio)
        ),
      },
    };
  }

  return agent;
}

/**
 * Applies `agent.movement_completed` payload.
 * If the visual avatar is still a short distance away from the final destination,
 * finishes the remaining glide smoothly or settles cleanly if within arrival epsilon.
 */
export function applyMovementCompleted(
  agent: AgentCharacterData,
  payload: Record<string, any>
): AgentCharacterData {
  const posObj = payload.position || {};
  const finalPos: [number, number, number] = [
    typeof posObj.x === "number"
      ? posObj.x
      : agent.targetPosition?.[0] ?? agent.position[0],
    typeof posObj.y === "number"
      ? posObj.y
      : agent.targetPosition?.[1] ?? agent.position[1],
    typeof posObj.z === "number"
      ? posObj.z
      : agent.targetPosition?.[2] ?? agent.position[2],
  ];

  const behavioralState = normalizeBehavioralState(
    payload.behavioral_state || "IDLE",
    payload.operational_status
  );
  const status = payload.operational_status
    ? (payload.operational_status as WorldAgentStatus)
    : behavioralToOperationalStatus(behavioralState, agent.status);

  const destination = String(
    payload.destination || agent.targetDestination || agent.station
  );
  const headingRadians = computeHeadingRadians(
    agent.position,
    finalPos,
    agent.headingRadians ?? 0
  );

  return {
    ...agent,
    station: destination,
    position: finalPos,
    targetPosition: null,
    targetDestination: null,
    activeMovementId: null,
    movementPlan: null,
    isMoving: false,
    headingRadians,
    behavioralState,
    status,
  };
}

/**
 * Applies `agent.movement_interrupted` payload.
 * Stops the agent at its current interpolated position (or reported stop position if within epsilon)
 * without teleporting back to origin.
 */
export function applyMovementInterrupted(
  agent: AgentCharacterData,
  payload: Record<string, any>
): AgentCharacterData {
  const posObj = payload.position || {};
  const stopPos: [number, number, number] = [
    typeof posObj.x === "number" ? posObj.x : agent.position[0],
    typeof posObj.y === "number" ? posObj.y : agent.position[1],
    typeof posObj.z === "number" ? posObj.z : agent.position[2],
  ];

  // Keep current visual position unless explicit stop coordinates are close
  const drift = distance3D(agent.position, stopPos);
  const effectiveStop: [number, number, number] =
    drift <= 2.5 ? stopPos : [...agent.position];

  const behavioralState = normalizeBehavioralState(
    payload.behavioral_state || "IDLE",
    payload.operational_status
  );
  const status = payload.operational_status
    ? (payload.operational_status as WorldAgentStatus)
    : behavioralToOperationalStatus(behavioralState, agent.status);

  return {
    ...agent,
    position: effectiveStop,
    targetPosition: null,
    targetDestination: null,
    activeMovementId: null,
    movementPlan: null,
    isMoving: false,
    behavioralState,
    status,
  };
}

/**
 * Steps an agent's position and heading forward by `deltaSeconds` along its active `movementPlan`.
 * Pure deterministic function suitable for both Three.js `useFrame` and unit tests.
 */
export function stepAgentMovement(
  agent: AgentCharacterData,
  deltaSeconds: number
): AgentCharacterData {
  const plan = agent.movementPlan;
  if (!plan || !agent.isMoving || deltaSeconds <= 0) {
    return agent;
  }

  let remainingStep = plan.speed * Math.min(deltaSeconds, 0.25);
  let currentPos: [number, number, number] = [...agent.position];
  let wpIndex = Math.max(1, plan.currentWaypointIndex);
  let heading = agent.headingRadians ?? 0;

  while (remainingStep > 0 && wpIndex < plan.waypoints.length) {
    const targetWp = plan.waypoints[wpIndex];
    const targetVec: [number, number, number] = [
      targetWp.x,
      targetWp.y,
      targetWp.z,
    ];
    const distToWp = distance3D(currentPos, targetVec);

    const desiredHeading = computeHeadingRadians(currentPos, targetVec, heading);
    heading = lerpAngleRadians(
      heading,
      desiredHeading,
      Math.min(1, deltaSeconds * 10)
    );

    if (distToWp <= remainingStep || distToWp <= WAYPOINT_ARRIVAL_EPSILON) {
      currentPos = targetVec;
      remainingStep -= distToWp;
      wpIndex += 1;
    } else {
      const ratio = remainingStep / distToWp;
      currentPos = [
        currentPos[0] + (targetVec[0] - currentPos[0]) * ratio,
        currentPos[1] + (targetVec[1] - currentPos[1]) * ratio,
        currentPos[2] + (targetVec[2] - currentPos[2]) * ratio,
      ];
      remainingStep = 0;
    }
  }

  const reachedEnd = wpIndex >= plan.waypoints.length;
  const traveled =
    plan.totalDistance > WAYPOINT_ARRIVAL_EPSILON
      ? Math.min(
          1,
          1 -
            distance3D(currentPos, plan.targetPosition) / plan.totalDistance
        )
      : 1;

  if (reachedEnd) {
    return {
      ...agent,
      position: [...plan.targetPosition],
      headingRadians: heading,
      isMoving: false,
      movementPlan: {
        ...plan,
        currentWaypointIndex: plan.waypoints.length,
        progressRatio: 1,
      },
    };
  }

  return {
    ...agent,
    position: currentPos,
    headingRadians: heading,
    isMoving: true,
    movementPlan: {
      ...plan,
      currentWaypointIndex: wpIndex,
      progressRatio: Math.max(plan.progressRatio, traveled),
    },
  };
}

/**
 * Reconciles an agent's spatial position when a snapshot arrives (initial load or reconnect).
 * - On initial hydration (`!existingAgent`) or explicit recovery (`forceTeleport` or distance >= 32u):
 *   sets authoritative coordinates directly.
 * - On reconnect when an existing agent's authoritative position or target differs from its current
 *   visual position: synthesizes a smooth movement interpolation plan instead of teleporting.
 */
export function reconcileAgentPositionOnSnapshot(
  existingAgent: AgentCharacterData | undefined,
  authoritativePosition: [number, number, number],
  targetPosition?: [number, number, number] | null,
  targetDestination?: string | null,
  activeMovementId?: string | null,
  behavioralStateRaw?: string | null,
  operationalStatus: WorldAgentStatus = "idle",
  forceTeleport: boolean = false,
  nowMs: number = Date.now()
): Pick<
  AgentCharacterData,
  | "position"
  | "targetPosition"
  | "targetDestination"
  | "activeMovementId"
  | "movementPlan"
  | "isMoving"
  | "headingRadians"
  | "behavioralState"
> {
  const behavioralState = normalizeBehavioralState(
    behavioralStateRaw,
    operationalStatus
  );

  // 1. Initial hydration or explicit recovery -> place directly at authoritative position
  if (!existingAgent || forceTeleport) {
    if (
      targetPosition &&
      distance3D(authoritativePosition, targetPosition) > WAYPOINT_ARRIVAL_EPSILON
    ) {
      const waypoints = buildLinearWaypoints(
        authoritativePosition,
        targetPosition,
        targetDestination || "destination"
      );
      const totalDistance = distance3D(authoritativePosition, targetPosition);
      return {
        position: authoritativePosition,
        targetPosition,
        targetDestination: targetDestination || null,
        activeMovementId: activeMovementId || `mov-init-${nowMs}`,
        movementPlan: {
          movementId: activeMovementId || `mov-init-${nowMs}`,
          origin: authoritativePosition,
          destination: targetDestination || "destination",
          targetPosition,
          waypoints,
          currentWaypointIndex: 1,
          speed: DEFAULT_MOVEMENT_SPEED,
          totalDistance,
          progressRatio: 0,
          startedAtMs: nowMs,
        },
        isMoving: true,
        headingRadians: computeHeadingRadians(
          authoritativePosition,
          targetPosition,
          0
        ),
        behavioralState: behavioralState === "IDLE" ? "MOVING" : behavioralState,
      };
    }

    return {
      position: authoritativePosition,
      targetPosition: null,
      targetDestination: null,
      activeMovementId: null,
      movementPlan: null,
      isMoving: false,
      headingRadians: 0,
      behavioralState,
    };
  }

  // 2. Existing agent reconnect reconciliation
  const currentPos: [number, number, number] = [...existingAgent.position];
  const effectiveGoal: [number, number, number] =
    targetPosition &&
    distance3D(currentPos, targetPosition) > WAYPOINT_ARRIVAL_EPSILON
      ? targetPosition
      : authoritativePosition;

  const deltaDist = distance3D(currentPos, effectiveGoal);

  // Emergency recovery threshold (e.g., corrupted out-of-world state)
  if (deltaDist >= EMERGENCY_RECOVERY_TELEPORT_DISTANCE) {
    return {
      position: effectiveGoal,
      targetPosition: null,
      targetDestination: null,
      activeMovementId: null,
      movementPlan: null,
      isMoving: false,
      headingRadians: existingAgent.headingRadians ?? 0,
      behavioralState,
    };
  }

  // Smoothly walk from current visual position to the reconciled goal (no teleportation!)
  if (deltaDist > WAYPOINT_ARRIVAL_EPSILON) {
    const destLabel = targetDestination || existingAgent.station || "reconciled";
    const movId = activeMovementId || `mov-reconcile-${nowMs}`;
    const waypoints = buildLinearWaypoints(currentPos, effectiveGoal, destLabel);
    return {
      position: currentPos,
      targetPosition: effectiveGoal,
      targetDestination: destLabel,
      activeMovementId: movId,
      movementPlan: {
        movementId: movId,
        origin: currentPos,
        destination: destLabel,
        targetPosition: effectiveGoal,
        waypoints,
        currentWaypointIndex: 1,
        speed: DEFAULT_MOVEMENT_SPEED,
        totalDistance: deltaDist,
        progressRatio: 0,
        startedAtMs: nowMs,
      },
      isMoving: true,
      headingRadians: computeHeadingRadians(
        currentPos,
        effectiveGoal,
        existingAgent.headingRadians ?? 0
      ),
      behavioralState,
    };
  }

  return {
    position: authoritativePosition,
    targetPosition: null,
    targetDestination: null,
    activeMovementId: null,
    movementPlan: null,
    isMoving: false,
    headingRadians: existingAgent.headingRadians ?? 0,
    behavioralState,
  };
}

// Re-export Phase 4.2 spatial navigation and collision avoidance systems
export { SpatialHashGrid } from "./spatialHashGrid";
export { CollisionAvoidanceSystem, DEFAULT_AVOIDANCE_CONFIG } from "./collisionAvoidance";
export {
  OfficeNavigationEngine,
  officeNavEngine,
  OFFICE_TOPOLOGY_NODES,
  OFFICE_TOPOLOGY_EDGES,
  WORKSTATION_CHAIR_OFFSET_Z,
  WORKSTATION_SCREEN_FACING_YAW,
} from "./officeNavigationEngine";


