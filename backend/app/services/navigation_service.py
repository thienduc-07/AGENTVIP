import heapq
import logging
import math
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session

from backend.app.core.errors import (
    NotFoundError,
    ValidationError,
    ConflictError,
    ForbiddenError,
)
from backend.app.models.agent import AgentModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.workstation_service import ZONE_CONFIGS
from backend.app.services.behavioral_state_service import (
    behavioral_state_service,
    BehavioralState,
)
from backend.app.services.event_service import (
    event_service,
    AGENT_MOVEMENT_STARTED,
    AGENT_MOVEMENT_PROGRESS,
    AGENT_MOVEMENT_COMPLETED,
    AGENT_MOVEMENT_INTERRUPTED,
)
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("agency.navigation")

OFFICE_BOUNDS_MIN_XZ = -40.0
OFFICE_BOUNDS_MAX_XZ = 40.0
OFFICE_BOUNDS_MIN_Y = 0.0
OFFICE_BOUNDS_MAX_Y = 10.0


def _euclidean_distance_3d(
    p1: Tuple[float, float, float],
    p2: Tuple[float, float, float],
) -> float:
    return math.sqrt(
        (p2[0] - p1[0]) ** 2
        + (p2[1] - p1[1]) ** 2
        + (p2[2] - p1[2]) ** 2
    )


def _build_static_topology() -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[str]]]:
    """
    Constructs the office navigation topology graph from ZONE_CONFIGS and
    interconnecting corridor nodes. No individual agent coordinates are hardcoded.
    """
    nodes: Dict[str, Dict[str, Any]] = {}

    # 1. Zone hub nodes derived from ZONE_CONFIGS
    for dept_name, cfg in ZONE_CONFIGS.items():
        zone_id = cfg["zone"]
        nodes[zone_id] = {
            "node_id": zone_id,
            "label": f"{dept_name} ({zone_id})",
            "node_type": "zone",
            "department": dept_name,
            "x": float(cfg["base_x"]),
            "y": float(cfg["base_y"]),
            "z": float(cfg["base_z"]),
        }

    # 2. Central corridor spine & wing junction nodes
    corridor_definitions = [
        ("corridor_north", "North Executive Corridor", 0.0, 1.0, -6.0),
        ("corridor_north_west", "North-West Wing Junction", -7.0, 1.0, -4.0),
        ("corridor_north_east", "North-East Wing Junction", 7.0, 1.0, -4.0),
        ("corridor_center", "Central Atrium Hub", 0.0, 1.0, 3.0),
        ("corridor_south_west", "South-West Wing Junction", -7.0, 1.0, 10.0),
        ("corridor_south_east", "South-East Wing Junction", 7.0, 1.0, 10.0),
        ("corridor_south", "South Operations Corridor", 0.0, 1.0, 16.0),
    ]
    for node_id, label, x, y, z in corridor_definitions:
        nodes[node_id] = {
            "node_id": node_id,
            "label": label,
            "node_type": "corridor",
            "department": None,
            "x": x,
            "y": y,
            "z": z,
        }

    # 3. Undirected adjacency graph connecting zones and corridors
    undirected_edges = [
        ("executive_suite", "corridor_north"),
        ("corridor_north", "corridor_north_west"),
        ("corridor_north", "corridor_north_east"),
        ("corridor_north", "corridor_center"),
        ("corridor_north_west", "engineering_bay"),
        ("corridor_north_west", "corridor_center"),
        ("corridor_north_west", "corridor_south_west"),
        ("corridor_north_east", "research_lab"),
        ("corridor_north_east", "corridor_center"),
        ("corridor_north_east", "corridor_south_east"),
        ("corridor_center", "support_lounge"),
        ("corridor_center", "corridor_south_west"),
        ("corridor_center", "corridor_south_east"),
        ("corridor_south_west", "marketing_studio"),
        ("corridor_south_west", "support_lounge"),
        ("corridor_south_west", "corridor_south"),
        ("corridor_south_east", "sales_wing"),
        ("corridor_south_east", "support_lounge"),
        ("corridor_south_east", "corridor_south"),
        ("support_lounge", "corridor_south"),
        ("corridor_south", "operations_hub"),
        ("corridor_south", "finance_office"),
        ("operations_hub", "finance_office"),
    ]

    adjacency: Dict[str, List[str]] = {nid: [] for nid in nodes}
    for u, v in undirected_edges:
        if u in adjacency and v in adjacency:
            if v not in adjacency[u]:
                adjacency[u].append(v)
            if u not in adjacency[v]:
                adjacency[v].append(u)

    return nodes, adjacency


STATIC_TOPOLOGY_NODES, STATIC_TOPOLOGY_ADJACENCY = _build_static_topology()

# Legacy / department aliases to topology zone IDs
DESTINATION_ALIASES: Dict[str, str] = {
    "captain_hq": "executive_suite",
    "helm_control": "executive_suite",
    "navigation_deck": "operations_hub",
    "engine_room": "engineering_bay",
    "medical_bay": "support_lounge",
    "crow_nest": "research_lab",
    "galley_kitchen": "marketing_studio",
    "library_arch": "research_lab",
    "executive": "executive_suite",
    "engineering": "engineering_bay",
    "ai research": "research_lab",
    "marketing": "marketing_studio",
    "sales": "sales_wing",
    "operations": "operations_hub",
    "finance": "finance_office",
    "customer success": "support_lounge",
}


class NavigationService:
    """
    Authoritative Hybrid Spatial Navigation Service (Phase 3.3.3.2).
    - Owns office navigation topology and workstation destination resolution.
    - Generates validated shortest-path waypoint sequences.
    - Persists authoritative destination and position on AgentModel.
    - Prevents conflicting movement commands unless explicit interruption is requested.
    - Emits agent.movement_started, agent.movement_progress, agent.movement_completed,
      and agent.movement_interrupted via EventService.
    """

    @staticmethod
    def validate_coordinates(x: float, y: float, z: float) -> None:
        if (
            math.isnan(x)
            or math.isnan(y)
            or math.isnan(z)
            or math.isinf(x)
            or math.isinf(y)
            or math.isinf(z)
        ):
            raise ValidationError(
                message="Spatial coordinates must be finite numbers",
                code="INVALID_SPATIAL_COORDINATES",
            )
        if not (OFFICE_BOUNDS_MIN_XZ <= x <= OFFICE_BOUNDS_MAX_XZ) or not (
            OFFICE_BOUNDS_MIN_XZ <= z <= OFFICE_BOUNDS_MAX_XZ
        ):
            raise ValidationError(
                message=(
                    f"Coordinates ({x:.2f}, {z:.2f}) are outside valid office bounds "
                    f"[{OFFICE_BOUNDS_MIN_XZ}, {OFFICE_BOUNDS_MAX_XZ}]"
                ),
                code="COORDINATES_OUT_OF_BOUNDS",
            )
        if not (OFFICE_BOUNDS_MIN_Y <= y <= OFFICE_BOUNDS_MAX_Y):
            raise ValidationError(
                message=(
                    f"Elevation Y={y:.2f} is outside valid bounds "
                    f"[{OFFICE_BOUNDS_MIN_Y}, {OFFICE_BOUNDS_MAX_Y}]"
                ),
                code="COORDINATES_OUT_OF_BOUNDS",
            )

    @classmethod
    def get_office_topology(
        cls,
        db: Session,
        organization_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Returns the office navigation topology graph and active physical workstation destinations."""
        nodes_out = []
        for nid, ndata in STATIC_TOPOLOGY_NODES.items():
            nodes_out.append(
                {
                    **ndata,
                    "neighbors": list(STATIC_TOPOLOGY_ADJACENCY.get(nid, [])),
                }
            )

        edges_out = []
        seen_pairs = set()
        for u, neighbors in STATIC_TOPOLOGY_ADJACENCY.items():
            u_node = STATIC_TOPOLOGY_NODES[u]
            for v in neighbors:
                pair = tuple(sorted((u, v)))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                v_node = STATIC_TOPOLOGY_NODES[v]
                dist = _euclidean_distance_3d(
                    (u_node["x"], u_node["y"], u_node["z"]),
                    (v_node["x"], v_node["y"], v_node["z"]),
                )
                edges_out.append(
                    {
                        "from": u,
                        "to": v,
                        "distance": round(dist, 3),
                    }
                )

        ws_destinations = []
        if organization_id:
            allocs = (
                db.query(WorkstationAllocationModel)
                .filter(
                    WorkstationAllocationModel.organization_id == organization_id,
                    WorkstationAllocationModel.is_virtual == False,  # noqa: E712
                    WorkstationAllocationModel.allocation_status == "ASSIGNED",
                )
                .all()
            )
            for ws in allocs:
                ws_destinations.append(
                    {
                        "workstation_id": ws.id,
                        "logical_workstation_id": ws.logical_workstation_id,
                        "agent_id": ws.agent_id,
                        "department": ws.department,
                        "office_zone": ws.office_zone,
                        "desk_number": ws.desk_number,
                        "x": float(ws.pos_x or 0.0),
                        "y": float(ws.pos_y or 1.0),
                        "z": float(ws.pos_z or 0.0),
                    }
                )

        return {
            "nodes": nodes_out,
            "edges": edges_out,
            "workstation_destinations": ws_destinations,
        }

    @classmethod
    def resolve_destination(
        cls,
        db: Session,
        destination: str,
        agent: AgentModel,
        organization_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validates and resolves a navigation destination to:
        - canonical_destination: str
        - destination_type: 'zone' | 'corridor' | 'workstation'
        - anchor_node_id: str (nearest topology node ID)
        - label: str
        - x, y, z: float
        Enforces strict tenant isolation for workstation destinations.
        """
        raw = (destination or "").strip()
        if not raw:
            raise ValidationError(
                message="Navigation destination cannot be empty",
                code="INVALID_MOVEMENT_DESTINATION",
            )

        effective_org = organization_id or agent.organization_id

        # 1. Direct topology node (zone or corridor)
        if raw in STATIC_TOPOLOGY_NODES:
            node = STATIC_TOPOLOGY_NODES[raw]
            return {
                "canonical_destination": node["node_id"],
                "destination_type": node["node_type"],
                "anchor_node_id": node["node_id"],
                "label": node["label"],
                "x": node["x"],
                "y": node["y"],
                "z": node["z"],
            }

        # 2. Department name or alias lookup
        alias_target = DESTINATION_ALIASES.get(raw.lower())
        if alias_target and alias_target in STATIC_TOPOLOGY_NODES:
            node = STATIC_TOPOLOGY_NODES[alias_target]
            return {
                "canonical_destination": node["node_id"],
                "destination_type": node["node_type"],
                "anchor_node_id": node["node_id"],
                "label": node["label"],
                "x": node["x"],
                "y": node["y"],
                "z": node["z"],
            }

        # 3. "own_workstation" keyword -> agent's allocated physical workstation
        if raw.lower() in ("own_workstation", "my_workstation", "assigned_workstation"):
            ws = (
                db.query(WorkstationAllocationModel)
                .filter(
                    WorkstationAllocationModel.agent_id == agent.id,
                    WorkstationAllocationModel.organization_id == effective_org,
                )
                .first()
            )
            if not ws:
                raise NotFoundError(
                    message=f"Agent '{agent.id}' does not have an allocated workstation",
                    code="WORKSTATION_NOT_FOUND",
                )
            return cls._validate_workstation_destination(ws, effective_org)

        # 4. Workstation lookup by logical_workstation_id or allocation id
        ws_candidates = (
            db.query(WorkstationAllocationModel)
            .filter(
                (WorkstationAllocationModel.logical_workstation_id == raw)
                | (WorkstationAllocationModel.id == raw)
            )
            .all()
        )
        if ws_candidates:
            # Prefer matching organization
            same_org_ws = [
                w for w in ws_candidates if w.organization_id == effective_org
            ]
            if not same_org_ws:
                raise ForbiddenError(
                    message=f"Workstation destination '{raw}' belongs to a different organization",
                    code="CROSS_TENANT_DESTINATION_DENIED",
                )
            return cls._validate_workstation_destination(same_org_ws[0], effective_org)

        raise ValidationError(
            message=f"Unknown or invalid navigation destination '{raw}'",
            code="INVALID_MOVEMENT_DESTINATION",
        )

    @classmethod
    def _validate_workstation_destination(
        cls,
        ws: WorkstationAllocationModel,
        organization_id: Optional[str],
    ) -> Dict[str, Any]:
        if organization_id and ws.organization_id != organization_id:
            raise ForbiddenError(
                message=f"Workstation '{ws.logical_workstation_id}' belongs to a different organization",
                code="CROSS_TENANT_DESTINATION_DENIED",
            )
        if ws.is_virtual or ws.allocation_status != "ASSIGNED":
            raise ValidationError(
                message=(
                    f"Workstation '{ws.logical_workstation_id}' is virtual or unassigned "
                    f"(status='{ws.allocation_status}', is_virtual={ws.is_virtual}) and cannot be navigated to physically"
                ),
                code="INVALID_WORKSTATION_DESTINATION",
            )
        x = float(ws.pos_x if ws.pos_x is not None else 0.0)
        y = float(ws.pos_y if ws.pos_y is not None else 1.0)
        z = float(ws.pos_z if ws.pos_z is not None else 0.0)
        cls.validate_coordinates(x, y, z)

        anchor_zone = ws.office_zone
        if anchor_zone not in STATIC_TOPOLOGY_NODES:
            dept_cfg = ZONE_CONFIGS.get(ws.department)
            anchor_zone = dept_cfg["zone"] if dept_cfg else "corridor_center"

        return {
            "canonical_destination": ws.logical_workstation_id,
            "destination_type": "workstation",
            "anchor_node_id": anchor_zone,
            "label": f"Workstation {ws.logical_workstation_id} ({ws.department})",
            "x": x,
            "y": y,
            "z": z,
            "workstation_id": ws.id,
        }

    @classmethod
    def find_nearest_topology_node(cls, x: float, y: float, z: float) -> str:
        best_id = "corridor_center"
        best_dist = float("inf")
        for nid, ndata in STATIC_TOPOLOGY_NODES.items():
            d = _euclidean_distance_3d((x, y, z), (ndata["x"], ndata["y"], ndata["z"]))
            if d < best_dist:
                best_dist = d
                best_id = nid
        return best_id

    @classmethod
    def shortest_topology_path(cls, start_node_id: str, end_node_id: str) -> List[str]:
        """Dijkstra's shortest path between two nodes in STATIC_TOPOLOGY_NODES."""
        if start_node_id == end_node_id:
            return [start_node_id]

        dist: Dict[str, float] = {nid: float("inf") for nid in STATIC_TOPOLOGY_NODES}
        prev: Dict[str, Optional[str]] = {nid: None for nid in STATIC_TOPOLOGY_NODES}
        dist[start_node_id] = 0.0

        pq: List[Tuple[float, str]] = [(0.0, start_node_id)]
        visited = set()

        while pq:
            current_dist, u = heapq.heappop(pq)
            if u in visited:
                continue
            visited.add(u)
            if u == end_node_id:
                break

            u_node = STATIC_TOPOLOGY_NODES[u]
            for v in STATIC_TOPOLOGY_ADJACENCY.get(u, []):
                if v in visited:
                    continue
                v_node = STATIC_TOPOLOGY_NODES[v]
                weight = _euclidean_distance_3d(
                    (u_node["x"], u_node["y"], u_node["z"]),
                    (v_node["x"], v_node["y"], v_node["z"]),
                )
                alt = current_dist + weight
                if alt < dist[v]:
                    dist[v] = alt
                    prev[v] = u
                    heapq.heappush(pq, (alt, v))

        path: List[str] = []
        curr: Optional[str] = end_node_id
        while curr is not None:
            path.append(curr)
            curr = prev.get(curr)
        path.reverse()
        if not path or path[0] != start_node_id:
            return [start_node_id, end_node_id]
        return path

    @classmethod
    def generate_waypoints(
        cls,
        origin: Tuple[float, float, float],
        resolved_dest: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], float]:
        """
        Generates an ordered sequence of waypoints from `origin` to `resolved_dest`
        along the office navigation topology graph.
        """
        ox, oy, oz = origin
        tx, ty, tz = resolved_dest["x"], resolved_dest["y"], resolved_dest["z"]
        direct_dist = _euclidean_distance_3d((ox, oy, oz), (tx, ty, tz))

        raw_points: List[Dict[str, Any]] = [
            {
                "node_id": "origin",
                "label": "Origin Position",
                "x": round(ox, 3),
                "y": round(oy, 3),
                "z": round(oz, 3),
            }
        ]

        # If origin and target are outside the immediate same desk/spot, route via topology
        if direct_dist > 3.5:
            start_node = cls.find_nearest_topology_node(ox, oy, oz)
            end_node = resolved_dest["anchor_node_id"]
            node_path = cls.shortest_topology_path(start_node, end_node)

            for nid in node_path:
                ndata = STATIC_TOPOLOGY_NODES[nid]
                pt = (ndata["x"], ndata["y"], ndata["z"])
                # Skip start_node if moving to it would backtrack away from a nearby target
                if (
                    len(node_path) == 1
                    and _euclidean_distance_3d(pt, (tx, ty, tz)) >= direct_dist
                ):
                    continue
                raw_points.append(
                    {
                        "node_id": nid,
                        "label": ndata["label"],
                        "x": round(ndata["x"], 3),
                        "y": round(ndata["y"], 3),
                        "z": round(ndata["z"], 3),
                    }
                )

        raw_points.append(
            {
                "node_id": resolved_dest["canonical_destination"],
                "label": resolved_dest["label"],
                "x": round(tx, 3),
                "y": round(ty, 3),
                "z": round(tz, 3),
            }
        )

        # Deduplicate consecutive points that are nearly identical (< 0.05 units apart)
        waypoints: List[Dict[str, Any]] = []
        cumulative_dist = 0.0
        for pt in raw_points:
            if not waypoints:
                waypoints.append(
                    {
                        "index": 0,
                        "node_id": pt["node_id"],
                        "label": pt["label"],
                        "x": pt["x"],
                        "y": pt["y"],
                        "z": pt["z"],
                        "segment_distance": 0.0,
                        "cumulative_distance": 0.0,
                    }
                )
                continue

            prev_wp = waypoints[-1]
            seg_dist = _euclidean_distance_3d(
                (prev_wp["x"], prev_wp["y"], prev_wp["z"]),
                (pt["x"], pt["y"], pt["z"]),
            )
            if seg_dist < 0.05 and len(waypoints) >= 1:
                # Replace label/node_id if this is the final destination point
                if pt is raw_points[-1]:
                    prev_wp["node_id"] = pt["node_id"]
                    prev_wp["label"] = pt["label"]
                    prev_wp["x"] = pt["x"]
                    prev_wp["y"] = pt["y"]
                    prev_wp["z"] = pt["z"]
                continue

            cumulative_dist += seg_dist
            waypoints.append(
                {
                    "index": len(waypoints),
                    "node_id": pt["node_id"],
                    "label": pt["label"],
                    "x": pt["x"],
                    "y": pt["y"],
                    "z": pt["z"],
                    "segment_distance": round(seg_dist, 3),
                    "cumulative_distance": round(cumulative_dist, 3),
                }
            )

        # Ensure at least 2 waypoints (origin -> destination) so frontend interpolation has a valid segment
        if len(waypoints) == 1:
            wp0 = waypoints[0]
            waypoints.append(
                {
                    "index": 1,
                    "node_id": resolved_dest["canonical_destination"],
                    "label": resolved_dest["label"],
                    "x": round(tx, 3),
                    "y": round(ty, 3),
                    "z": round(tz, 3),
                    "segment_distance": 0.0,
                    "cumulative_distance": 0.0,
                }
            )

        return waypoints, round(cumulative_dist, 3)

    @classmethod
    def _get_validated_agent(
        cls,
        db: Session,
        agent_id: str,
        organization_id: Optional[str],
    ) -> Tuple[AgentModel, Optional[str]]:
        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if not agent:
            raise NotFoundError(
                message=f"Agent '{agent_id}' not found",
                code="AGENT_NOT_FOUND",
            )

        rec = (
            db.query(RecruitmentRecordModel)
            .filter(RecruitmentRecordModel.agent_id == agent_id)
            .first()
        )
        agent_org = agent.organization_id or (rec.organization_id if rec else None)

        if organization_id and agent_org and agent_org != organization_id:
            raise NotFoundError(
                message=f"Agent '{agent_id}' not found",
                code="AGENT_NOT_FOUND",
            )

        if rec and rec.lifecycle_state in ("SUSPENDED", "OFFBOARDED", "RETIRED"):
            raise ConflictError(
                message=f"Agent '{agent_id}' is in lifecycle state '{rec.lifecycle_state}' and cannot navigate",
                code="AGENT_LIFECYCLE_INACTIVE",
            )
        if agent.status == "offline":
            raise ConflictError(
                message=f"Agent '{agent_id}' is offline and cannot navigate",
                code="AGENT_OFFLINE",
            )

        return agent, organization_id or agent_org or "org_default_company"

    @classmethod
    def start_movement(
        cls,
        db: Session,
        agent_id: str,
        destination: str,
        organization_id: Optional[str] = None,
        task_id: Optional[str] = None,
        speed: float = 4.0,
        allow_interrupt: bool = False,
        target_state_on_arrival: str = "IDLE",
        commit: bool = True,
        broadcast: bool = True,
    ) -> Dict[str, Any]:
        """
        Initiates an authoritative spatial movement for an agent:
        1. Validates agent ownership, lifecycle, and target_state_on_arrival.
        2. Prevents conflicting movement commands unless allow_interrupt=True.
        3. Validates destination and generates shortest-path waypoints.
        4. Persists target coordinates, destination, and active_movement_id on AgentModel.
        5. Transitions behavioral_state to MOVING.
        6. Emits agent.movement_started event.
        """
        agent, effective_org = cls._get_validated_agent(db, agent_id, organization_id)
        arrival_state_enum = behavioral_state_service.parse_state(target_state_on_arrival)

        # Conflict check: prevent conflicting movement commands
        if agent.active_movement_id or (agent.behavioral_state or "").upper() == BehavioralState.MOVING.value:
            if not allow_interrupt:
                raise ConflictError(
                    message=(
                        f"Agent '{agent_id}' already has an active movement "
                        f"('{agent.active_movement_id}' -> '{agent.target_destination}'). "
                        f"Set allow_interrupt=True or interrupt the active movement first."
                    ),
                    code="MOVEMENT_CONFLICT",
                )
            # Cleanly interrupt existing movement before starting new route
            cls.interrupt_movement(
                db=db,
                agent_id=agent_id,
                reason=f"Rerouted to '{destination}'",
                target_state=BehavioralState.IDLE.value,
                organization_id=effective_org,
                commit=False,
                broadcast=broadcast,
            )

        resolved_dest = cls.resolve_destination(
            db=db,
            destination=destination,
            agent=agent,
            organization_id=effective_org,
        )

        ox = float(agent.pos_x if agent.pos_x is not None else 0.0)
        oy = float(agent.pos_y if agent.pos_y is not None else 1.0)
        oz = float(agent.pos_z if agent.pos_z is not None else 0.0)

        waypoints, total_distance = cls.generate_waypoints((ox, oy, oz), resolved_dest)
        safe_speed = max(0.1, min(float(speed), 20.0))
        estimated_duration = round(total_distance / safe_speed, 3) if total_distance > 0 else 0.0
        movement_id = f"mov-{uuid.uuid4().hex[:12]}"

        # Persist authoritative movement destination on AgentModel
        agent.target_pos_x = resolved_dest["x"]
        agent.target_pos_y = resolved_dest["y"]
        agent.target_pos_z = resolved_dest["z"]
        agent.target_destination = resolved_dest["canonical_destination"]
        agent.active_movement_id = movement_id
        agent.updated_at = datetime.utcnow()

        # Transition behavioral state to MOVING
        behavioral_state_service.transition_state(
            db=db,
            agent_id=agent.id,
            target_state=BehavioralState.MOVING,
            organization_id=effective_org,
            task_id=task_id,
            reason=f"Navigating to {resolved_dest['canonical_destination']}",
            sync_operational_status=True,
            force_recovery=True,
            commit=False,
            broadcast=broadcast,
        )

        plan_payload = {
            "movement_id": movement_id,
            "agent_id": agent.id,
            "organization_id": effective_org,
            "behavioral_state": agent.behavioral_state,
            "operational_status": agent.status,
            "origin": {"x": round(ox, 3), "y": round(oy, 3), "z": round(oz, 3)},
            "destination": resolved_dest["canonical_destination"],
            "destination_type": resolved_dest["destination_type"],
            "target_position": {
                "x": round(resolved_dest["x"], 3),
                "y": round(resolved_dest["y"], 3),
                "z": round(resolved_dest["z"], 3),
            },
            "waypoints": waypoints,
            "total_distance": total_distance,
            "speed": safe_speed,
            "estimated_duration_seconds": estimated_duration,
            "target_state_on_arrival": arrival_state_enum.value,
        }

        ev = event_service.create_event(
            db=db,
            event_type=AGENT_MOVEMENT_STARTED,
            agent_id=agent.id,
            task_id=task_id or agent.current_task_id,
            organization_id=effective_org,
            payload=plan_payload,
            commit=commit,
        )
        if broadcast and ev:
            ws_manager.broadcast_sync(ev.to_envelope())

        return plan_payload

    @classmethod
    def update_movement_progress(
        cls,
        db: Session,
        agent_id: str,
        movement_id: str,
        pos_x: float,
        pos_y: float = 1.0,
        pos_z: float = 0.0,
        waypoint_index: Optional[int] = None,
        progress_ratio: Optional[float] = None,
        organization_id: Optional[str] = None,
        commit: bool = True,
        broadcast: bool = True,
    ) -> AgentModel:
        """
        Updates authoritative intermediate agent coordinates during an active movement
        and emits agent.movement_progress.
        """
        agent, effective_org = cls._get_validated_agent(db, agent_id, organization_id)

        if not agent.active_movement_id:
            raise ConflictError(
                message=f"Agent '{agent_id}' has no active movement in progress",
                code="NO_ACTIVE_MOVEMENT",
            )
        if agent.active_movement_id != movement_id:
            raise ConflictError(
                message=(
                    f"Movement ID '{movement_id}' does not match active movement "
                    f"'{agent.active_movement_id}' for agent '{agent_id}'"
                ),
                code="MOVEMENT_ID_MISMATCH",
            )

        cls.validate_coordinates(pos_x, pos_y, pos_z)

        agent.pos_x = round(float(pos_x), 3)
        agent.pos_y = round(float(pos_y), 3)
        agent.pos_z = round(float(pos_z), 3)
        agent.updated_at = datetime.utcnow()

        ev = event_service.create_event(
            db=db,
            event_type=AGENT_MOVEMENT_PROGRESS,
            agent_id=agent.id,
            task_id=agent.current_task_id,
            organization_id=effective_org,
            payload={
                "movement_id": movement_id,
                "agent_id": agent.id,
                "organization_id": effective_org,
                "position": {"x": agent.pos_x, "y": agent.pos_y, "z": agent.pos_z},
                "target_position": {
                    "x": agent.target_pos_x,
                    "y": agent.target_pos_y,
                    "z": agent.target_pos_z,
                },
                "destination": agent.target_destination,
                "waypoint_index": waypoint_index,
                "progress_ratio": progress_ratio,
            },
            commit=commit,
        )
        if broadcast and ev:
            ws_manager.broadcast_sync(ev.to_envelope())

        return agent

    @classmethod
    def complete_movement(
        cls,
        db: Session,
        agent_id: str,
        movement_id: Optional[str] = None,
        target_state: str = "IDLE",
        organization_id: Optional[str] = None,
        task_id: Optional[str] = None,
        commit: bool = True,
        broadcast: bool = True,
    ) -> AgentModel:
        """
        Completes an active movement:
        1. Validates active movement ID.
        2. Commits final authoritative position (pos_x, pos_y, pos_z) = target_pos.
        3. Clears active_movement_id and target_pos_*.
        4. Transitions behavioral_state from MOVING to target_state (default IDLE).
        5. Emits agent.movement_completed.
        """
        agent, effective_org = cls._get_validated_agent(db, agent_id, organization_id)

        if not agent.active_movement_id and (agent.behavioral_state or "").upper() != BehavioralState.MOVING.value:
            raise ConflictError(
                message=f"Agent '{agent_id}' has no active movement to complete",
                code="NO_ACTIVE_MOVEMENT",
            )
        if movement_id and agent.active_movement_id and agent.active_movement_id != movement_id:
            raise ConflictError(
                message=(
                    f"Movement ID '{movement_id}' does not match active movement "
                    f"'{agent.active_movement_id}' for agent '{agent_id}'"
                ),
                code="MOVEMENT_ID_MISMATCH",
            )

        completed_movement_id = agent.active_movement_id or movement_id or f"mov-{uuid.uuid4().hex[:8]}"
        completed_destination = agent.target_destination or agent.station

        if agent.target_pos_x is not None:
            agent.pos_x = round(float(agent.target_pos_x), 3)
        if agent.target_pos_y is not None:
            agent.pos_y = round(float(agent.target_pos_y), 3)
        if agent.target_pos_z is not None:
            agent.pos_z = round(float(agent.target_pos_z), 3)
        if completed_destination:
            agent.station = completed_destination

        agent.target_pos_x = None
        agent.target_pos_y = None
        agent.target_pos_z = None
        agent.target_destination = None
        agent.active_movement_id = None
        agent.updated_at = datetime.utcnow()

        target_enum = behavioral_state_service.parse_state(target_state)
        behavioral_state_service.transition_state(
            db=db,
            agent_id=agent.id,
            target_state=target_enum,
            organization_id=effective_org,
            task_id=task_id or agent.current_task_id,
            reason=f"Arrived at {completed_destination}",
            sync_operational_status=True,
            force_recovery=True,
            commit=False,
            broadcast=broadcast,
        )

        ev = event_service.create_event(
            db=db,
            event_type=AGENT_MOVEMENT_COMPLETED,
            agent_id=agent.id,
            task_id=task_id or agent.current_task_id,
            organization_id=effective_org,
            payload={
                "movement_id": completed_movement_id,
                "agent_id": agent.id,
                "organization_id": effective_org,
                "destination": completed_destination,
                "position": {
                    "x": float(agent.pos_x or 0.0),
                    "y": float(agent.pos_y or 1.0),
                    "z": float(agent.pos_z or 0.0),
                },
                "behavioral_state": agent.behavioral_state,
                "operational_status": agent.status,
            },
            commit=commit,
        )
        if broadcast and ev:
            ws_manager.broadcast_sync(ev.to_envelope())

        return agent

    @classmethod
    def interrupt_movement(
        cls,
        db: Session,
        agent_id: str,
        reason: Optional[str] = "Movement interrupted",
        pos_x: Optional[float] = None,
        pos_y: Optional[float] = None,
        pos_z: Optional[float] = None,
        target_state: str = "IDLE",
        organization_id: Optional[str] = None,
        commit: bool = True,
        broadcast: bool = True,
    ) -> AgentModel:
        """
        Interrupts an active movement, persists current coordinates, clears target destination,
        transitions behavioral_state, and emits agent.movement_interrupted.
        """
        agent, effective_org = cls._get_validated_agent(db, agent_id, organization_id)

        interrupted_movement_id = agent.active_movement_id
        previous_destination = agent.target_destination

        if pos_x is not None and pos_z is not None:
            eff_y = float(pos_y if pos_y is not None else (agent.pos_y or 1.0))
            cls.validate_coordinates(float(pos_x), eff_y, float(pos_z))
            agent.pos_x = round(float(pos_x), 3)
            agent.pos_y = round(eff_y, 3)
            agent.pos_z = round(float(pos_z), 3)

        agent.target_pos_x = None
        agent.target_pos_y = None
        agent.target_pos_z = None
        agent.target_destination = None
        agent.active_movement_id = None
        agent.updated_at = datetime.utcnow()

        target_enum = behavioral_state_service.parse_state(target_state)
        behavioral_state_service.transition_state(
            db=db,
            agent_id=agent.id,
            target_state=target_enum,
            organization_id=effective_org,
            task_id=agent.current_task_id,
            reason=reason or "Movement interrupted",
            sync_operational_status=True,
            force_recovery=True,
            commit=False,
            broadcast=broadcast,
        )

        ev = event_service.create_event(
            db=db,
            event_type=AGENT_MOVEMENT_INTERRUPTED,
            agent_id=agent.id,
            task_id=agent.current_task_id,
            organization_id=effective_org,
            payload={
                "movement_id": interrupted_movement_id,
                "agent_id": agent.id,
                "organization_id": effective_org,
                "previous_destination": previous_destination,
                "reason": reason or "Movement interrupted",
                "position": {
                    "x": float(agent.pos_x or 0.0),
                    "y": float(agent.pos_y or 1.0),
                    "z": float(agent.pos_z or 0.0),
                },
                "behavioral_state": agent.behavioral_state,
                "operational_status": agent.status,
            },
            commit=commit,
        )
        if broadcast and ev:
            ws_manager.broadcast_sync(ev.to_envelope())

        return agent


navigation_service = NavigationService()

