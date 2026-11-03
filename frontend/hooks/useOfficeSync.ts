"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getWorldSnapshot } from "@/lib/api/world";
import { getWorkstationOverview, ZoneConfig, WorkstationAllocation } from "@/lib/api/workstations";
import { ensureAuthenticatedSession } from "@/lib/api/client";
import { syncManager } from "@/lib/websocket/syncManager";
import { AgentAvatarData } from "@/components/office/AgentAvatar";
import { WorkstationData } from "@/components/office/Workstation";
import { DepartmentZoneData } from "@/components/office/DepartmentZone";
import { CanonicalAgentState } from "@/types/office";
import { EventEnvelope } from "@/types/events";
import { normalizeBehavioralState } from "@/lib/spatialMovement";

export interface OfficeSyncState {
  organizationId: string;
  departments: Record<string, DepartmentZoneData>;
  workstations: Record<string, WorkstationData>;
  agents: Record<string, AgentAvatarData>;
  sequenceId: number;
  connectionStatus: "connected" | "connecting" | "reconnecting" | "error" | "demo_fallback";
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => Promise<void>;
  updateAgentPosition: (agentId: string, pos: [number, number, number]) => void;
}

const DEFAULT_ZONE_SPACING: Record<string, { x: number; z: number }> = {
  Executive: { x: 3.0, z: 2.5 },
  Engineering: { x: 2.2, z: 2.0 },
  "AI Research": { x: 2.2, z: 2.0 },
  Marketing: { x: 2.2, z: 2.0 },
  Sales: { x: 2.2, z: 2.0 },
  Operations: { x: 2.2, z: 2.0 },
  Finance: { x: 2.2, z: 2.0 },
  "Customer Success": { x: 2.0, z: 1.8 },
};

export const DEPARTMENT_ZONE_DEFAULTS: Record<
  string,
  { zone: string; base_x: number; base_z: number; max_physical_desks: number; floor: number }
> = {
  Executive: { zone: "executive_suite", base_x: -6.0, base_z: -3.0, max_physical_desks: 4, floor: 6 },
  Engineering: { zone: "engineering_bay", base_x: -2.0, base_z: -3.0, max_physical_desks: 10, floor: 5 },
  "AI Research": { zone: "research_lab", base_x: -2.0, base_z: -3.0, max_physical_desks: 8, floor: 4 },
  Marketing: { zone: "marketing_studio", base_x: -8.0, base_z: -3.0, max_physical_desks: 6, floor: 3 },
  Sales: { zone: "sales_wing", base_x: 8.0, base_z: -2.0, max_physical_desks: 6, floor: 3 },
  Operations: { zone: "operations_hub", base_x: -8.0, base_z: -3.0, max_physical_desks: 6, floor: 1 },
  Finance: { zone: "finance_office", base_x: 8.0, base_z: -3.0, max_physical_desks: 6, floor: 1 },
  "Customer Success": { zone: "support_lounge", base_x: 8.0, base_z: 4.5, max_physical_desks: 6, floor: 1 },
};

export const DEFAULT_DEPARTMENT_DESKS: Record<
  string,
  Array<{ id: string; label: string; offset_x: number; offset_z: number; defaultAgentId?: string }>
> = {
  Executive: [
    { id: "ws-exec-01", label: "Bàn CEO · Victoria Vance", offset_x: -3.0, offset_z: 0.0, defaultAgentId: "agent-exec-ceo" },
    { id: "ws-exec-02", label: "Bàn Cố Vấn Chiến Lược", offset_x: 3.0, offset_z: 0.0, defaultAgentId: "agent-remote-consultant-01" },
  ],
  Engineering: [
    { id: "ws-eng-01", label: "Bàn Trưởng Nhóm Kỹ Thuật · David Chen", offset_x: -8.0, offset_z: -2.0, defaultAgentId: "agent-eng-lead" },
    { id: "ws-eng-02", label: "Bàn Kỹ Sư MLOps", offset_x: -2.0, offset_z: -1.0, defaultAgentId: "recruited-spec-test-mlops-1234" },
    { id: "ws-eng-03", label: "Bàn Kỹ Sư Hệ Thống (DevOps)", offset_x: 3.0, offset_z: -1.0, defaultAgentId: "agent-suspended-spec-01" },
    { id: "ws-eng-04", label: "Bàn Lập Trình Viên Backend", offset_x: -2.0, offset_z: 2.5 },
    { id: "ws-eng-05", label: "Bàn Lập Trình Viên Frontend", offset_x: 3.0, offset_z: 2.5 },
  ],
  "AI Research": [
    { id: "ws-ai-01", label: "Bàn Giám Đốc AI · Elena Rostova", offset_x: -8.0, offset_z: -2.0, defaultAgentId: "agent-research-ai" },
    { id: "ws-ai-02", label: "Bàn Nhà Khoa Học Dữ Liệu 1", offset_x: -1.5, offset_z: -1.0 },
    { id: "ws-ai-03", label: "Bàn Kỹ Sư Mô Hình Ngôn Ngữ", offset_x: 3.5, offset_z: -1.0 },
  ],
  Marketing: [
    { id: "ws-mkt-01", label: "Bàn Phó Chủ Tịch · Sophia Martinez", offset_x: -2.0, offset_z: -2.0, defaultAgentId: "agent-mkt-growth" },
    { id: "ws-mkt-02", label: "Bàn Chiến Lược Tăng Trưởng", offset_x: 3.0, offset_z: -2.0 },
  ],
  Sales: [
    { id: "ws-sales-01", label: "Bàn Giám Đốc Kinh Doanh · Marcus Reynolds", offset_x: 2.0, offset_z: 0.0, defaultAgentId: "agent-sales-director" },
    { id: "ws-sales-02", label: "Bàn Đại Diện Giải Pháp DN", offset_x: -3.0, offset_z: 0.0 },
  ],
  Finance: [
    { id: "ws-fin-01", label: "Bàn CFO · Julian Thorne", offset_x: 2.0, offset_z: -1.0, defaultAgentId: "agent-fin-controller" },
    { id: "ws-fin-02", label: "Bàn Kiểm Toán & Ngân Quỹ", offset_x: -3.0, offset_z: -1.0 },
  ],
  Operations: [
    { id: "ws-ops-01", label: "Bàn Trưởng Ban Vận Hành · Amara Okafor", offset_x: -2.0, offset_z: -1.0, defaultAgentId: "agent-ops-recruiter" },
    { id: "ws-ops-02", label: "Bàn Nhân Sự & Tuyển Dụng", offset_x: 3.0, offset_z: -1.0 },
  ],
  "Customer Success": [
    { id: "ws-cs-01", label: "Bàn Trưởng Ban CSKH · Liam O'Connor", offset_x: 2.0, offset_z: 1.5, defaultAgentId: "agent-support-lead" },
    { id: "ws-cs-02", label: "Bàn CSKH Doanh Nghiệp Tier-1", offset_x: -3.0, offset_z: 1.5 },
  ],
};

export function getDepartmentFloor(dept?: string): number {
  if (!dept) return 1;
  const d = dept.toLowerCase();
  if (d.includes("exec") || d.includes("ceo") || d.includes("leadership")) return 6;
  if (d.includes("eng") || d.includes("dev") || d.includes("software") || d.includes("architect")) return 5;
  if (d.includes("research") || d.includes("data") || d.includes("science") || d.includes("ai")) return 4;
  if (d.includes("market") || d.includes("sale") || d.includes("growth") || d.includes("media")) return 3;
  if (d.includes("design") || d.includes("creative") || d.includes("product") || d.includes("ui") || d.includes("ux")) return 2;
  return 1; // Operations, Finance, Support, HR, Reception
}

export function getFloorElevation(floor: number): number {
  return (floor - 1) * 6.0;
}

export function useOfficeSync(initialOrgId: string = "org_default_company"): OfficeSyncState {
  const [organizationId, setOrganizationId] = useState(initialOrgId);
  const [departments, setDepartments] = useState<Record<string, DepartmentZoneData>>({});
  const [workstations, setWorkstations] = useState<Record<string, WorkstationData>>({});
  const [agents, setAgents] = useState<Record<string, AgentAvatarData>>({});
  const [sequenceId, setSequenceId] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "reconnecting" | "error" | "demo_fallback"
  >("connecting");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const latestSequenceRef = useRef<number>(0);

  // 1. Initial Authoritative Hydration from REST APIs
  const loadOfficeState = useCallback(async () => {
    setIsLoading(true);
    setConnectionStatus("connecting");
    setErrorMessage(null);

    try {
      // Ensure local preview session is authenticated before querying backend
      if (typeof window !== "undefined") {
        await ensureAuthenticatedSession();
      }

      // Parallel fetch of World Snapshot and Workstation Overview
      const [snapshotRes, workstationRes] = await Promise.allSettled([
        getWorldSnapshot({ organizationId }),
        getWorkstationOverview({ organizationId }),
      ]);

      if (!isMountedRef.current) return;

      const loadedAgents: Record<string, AgentAvatarData> = {};
      const loadedWorkstations: Record<string, WorkstationData> = {};
      const loadedDepartments: Record<string, DepartmentZoneData> = {};

      let currentSeq = 0;
      let isStaleSnapshot = false;

      // 1. Initialize Baseline Department Zones
      Object.entries(DEPARTMENT_ZONE_DEFAULTS).forEach(([deptName, def]) => {
        const spacing = DEFAULT_ZONE_SPACING[deptName] || { x: 2.2, z: 2.0 };
        const deptElev = getFloorElevation(def.floor);
        loadedDepartments[deptName] = {
          department: deptName,
          zone: def.zone,
          base_x: def.base_x,
          base_y: deptElev,
          base_z: def.base_z,
          max_physical_desks: def.max_physical_desks,
          desk_spacing_x: spacing.x,
          desk_spacing_z: spacing.z,
          workstations: [],
        };
      });

      // 2. Initialize Default Physical Desks for Each Department
      Object.entries(DEFAULT_DEPARTMENT_DESKS).forEach(([deptName, deskDefs]) => {
        const deptZone = loadedDepartments[deptName];
        if (!deptZone) return;

        deskDefs.forEach((dDef) => {
          const wsKey = dDef.id;
          loadedWorkstations[wsKey] = {
            workstation_id: wsKey,
            zone: deptZone.zone,
            label: dDef.label,
            department: deptName,
            desk_number: null,
            pos_x: deptZone.base_x + dDef.offset_x,
            pos_y: deptZone.base_y + 0.05,
            pos_z: deptZone.base_z + dDef.offset_z,
            occupancy_status: "vacant",
            assigned_employee: null,
            is_virtual: false,
          };
        });
      });

      // 3. Process World Snapshot (Authoritative Agents)
      if (snapshotRes.status === "fulfilled" && snapshotRes.value) {
        const snap = snapshotRes.value;
        currentSeq = snap.sequence_id || 0;

        if (currentSeq < latestSequenceRef.current && latestSequenceRef.current > 0) {
          isStaleSnapshot = true;
          console.warn(
            `[useOfficeSync] Snapshot sequence ${currentSeq} is older than watermark ${latestSequenceRef.current}; merging without rolling back watermark`
          );
        } else {
          latestSequenceRef.current = currentSeq;
          setSequenceId(currentSeq);
        }

        (snap.agents || []).forEach((item) => {
          const bState = (normalizeBehavioralState(
            item.behavioral_state,
            item.operational_status as any
          ) as CanonicalAgentState) || "IDLE";

          const floor = getDepartmentFloor(item.department);
          const floorElev = getFloorElevation(floor);
          const deptZone = loadedDepartments[item.department] || loadedDepartments["Executive"];

          // Check if this agent matches a designated department desk
          const matchingDefaultDesk = Object.values(DEFAULT_DEPARTMENT_DESKS[item.department] || []).find(
            (d) => d.defaultAgentId === item.employee_id
          );

          let assignedWsId = item.assigned_workstation || matchingDefaultDesk?.id || null;
          let px = deptZone ? deptZone.base_x : 0;
          let py = floorElev + 0.05;
          let pz = deptZone ? deptZone.base_z : 0;

          if (assignedWsId && loadedWorkstations[assignedWsId]) {
            const ws = loadedWorkstations[assignedWsId];
            px = ws.pos_x;
            py = ws.pos_y;
            pz = ws.pos_z;

            // Mark workstation occupied
            ws.occupancy_status = "occupied";
            ws.assigned_employee = item.employee_id;
            ws.assigned_employee_name = item.name;
            ws.assigned_employee_role = item.role;
            ws.occupant_state = bState;
          } else {
            // Unassigned / floating agent: place cleanly in department zone collaboration/standup area
            px = deptZone ? deptZone.base_x + 1.8 : 0;
            pz = deptZone ? deptZone.base_z + 2.5 : 0;
          }

          const targetCoords = (item as any).target_position || item.target_coordinates;

          loadedAgents[item.employee_id] = {
            id: item.employee_id,
            name: item.name,
            role: item.role,
            department: item.department,
            position: [px, py, pz],
            targetPosition: targetCoords
              ? [targetCoords.x, targetCoords.y < 2.0 ? floorElev + 0.05 : targetCoords.y, targetCoords.z]
              : null,
            headingRadians: assignedWsId ? Math.PI : 0,
            behavioralState: bState,
            operationalStatus: item.operational_status,
            currentTaskTitle: item.current_active_task?.title ?? null,
            assignedWorkstation: assignedWsId,
            isMoving: Boolean(item.active_movement_id || targetCoords),
          };
        });

        // Synthetic Benchmark Workload Scaler (For Phase 1 & Phase 5 Performance Auditing)
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          const benchmarkCountStr = params.get("benchmark_agents");
          if (benchmarkCountStr) {
            const targetCount = parseInt(benchmarkCountStr, 10);
            if (!isNaN(targetCount) && targetCount > 0) {
              const depts = [
                "Engineering",
                "AI Research",
                "Marketing",
                "Sales",
                "Finance",
                "Operations",
                "Customer Success",
                "Executive",
              ];
              for (let i = 1; i <= targetCount; i++) {
                const agentId = `bench-agent-${String(i).padStart(3, "0")}`;
                if (!loadedAgents[agentId]) {
                  const dept = depts[i % depts.length];
                  const floor = getDepartmentFloor(dept);
                  const floorElev = getFloorElevation(floor);
                  const deptZone = loadedDepartments[dept] || loadedDepartments["Executive"];
                  const angle = (i * 0.45) % (Math.PI * 2);
                  const radius = 1.2 + (i % 6) * 0.65;
                  const px = (deptZone?.base_x || 0) + Math.cos(angle) * radius;
                  const py = floorElev + 0.05;
                  const pz = (deptZone?.base_z || 0) + Math.sin(angle) * radius;

                  loadedAgents[agentId] = {
                    id: agentId,
                    name: `Specialist #${i} (${dept})`,
                    role: `${dept} Specialist`,
                    department: dept,
                    position: [px, py, pz],
                    headingRadians: angle,
                    behavioralState: i % 3 === 0 ? "IN_PROGRESS" : "IDLE",
                    operationalStatus: "idle",
                    assignedWorkstation: null,
                  };
                }
              }
            }
          }
        }

        // Map snapshot workstations if present from backend
        (snap.workstations || []).forEach((ws) => {
          const wsFloor = getDepartmentFloor(ws.zone);
          const wsElev = getFloorElevation(wsFloor);
          let wsY = ws.spatial_coordinates?.y ?? 1;
          if (wsY < 2.0) wsY = wsElev + 0.05;

          if (!loadedWorkstations[ws.workstation_id]) {
            loadedWorkstations[ws.workstation_id] = {
              workstation_id: ws.workstation_id,
              zone: ws.zone,
              label: ws.label || ws.workstation_id,
              department: ws.zone,
              desk_number: null,
              pos_x: ws.spatial_coordinates?.x ?? 0,
              pos_y: wsY,
              pos_z: ws.spatial_coordinates?.z ?? 0,
              occupancy_status: ws.occupancy_status || "vacant",
              assigned_employee: ws.assigned_employee,
              is_virtual: ws.is_virtual ?? false,
            };
          }
        });
      }

      // 4. Process Workstation Overview Allocations (Overriding with authoritative backend assignments)
      if (workstationRes.status === "fulfilled" && workstationRes.value) {
        const wsOverview = workstationRes.value;
        const allocations = wsOverview.allocations || [];

        allocations.forEach((alloc: WorkstationAllocation) => {
          const occupant = loadedAgents[alloc.agent_id];
          const wsKey = alloc.logical_workstation_id || alloc.id;
          const wsFloor = getDepartmentFloor(alloc.department || alloc.office_zone);
          const wsElev = getFloorElevation(wsFloor);

          let wsY = alloc.pos_y ?? 1.0;
          if (wsY < 2.0) wsY = wsElev + 0.05;

          loadedWorkstations[wsKey] = {
            workstation_id: wsKey,
            zone: alloc.office_zone || alloc.department,
            label: `Bàn #${alloc.desk_number ?? "V"}-${alloc.department}`,
            department: alloc.department,
            desk_number: alloc.desk_number,
            pos_x: alloc.pos_x ?? 0,
            pos_y: wsY,
            pos_z: alloc.pos_z ?? 0,
            occupancy_status: alloc.allocation_status === "ASSIGNED" ? "occupied" : "vacant",
            assigned_employee: alloc.agent_id,
            assigned_employee_name: alloc.agent_name || occupant?.name,
            assigned_employee_role: alloc.agent_role || occupant?.role,
            occupant_state: occupant?.behavioralState || "IDLE",
            is_virtual: alloc.is_virtual,
          };

          if (occupant) {
            occupant.assignedWorkstation = wsKey;
            occupant.position = [alloc.pos_x ?? occupant.position[0], wsY, alloc.pos_z ?? occupant.position[2]];
            occupant.headingRadians = Math.PI;
          }
        });
      }

      // 5. Group Workstations into Department Zones
      Object.keys(loadedDepartments).forEach((deptName) => {
        loadedDepartments[deptName].workstations = Object.values(loadedWorkstations).filter(
          (w) => w.department === deptName
        );
      });

      if (!isStaleSnapshot) {
        setAgents(loadedAgents);
      } else {
        setAgents((prev) => ({
          ...loadedAgents,
          ...prev,
        }));
      }
      setWorkstations(loadedWorkstations);
      setDepartments(loadedDepartments);
      setConnectionStatus("connected");
      setIsLoading(false);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      console.warn("[useOfficeSync] Backend snapshot unavailable:", err);
      setConnectionStatus("error");
      setErrorMessage(err?.message || "Không thể kết nối đến máy chủ PROVIPAGENT");
      setIsLoading(false);
    }
  }, [organizationId]);

  // 2. Real-Time WebSocket Synchronization & Event Ingestion
  useEffect(() => {
    isMountedRef.current = true;
    syncManager.connect();
    loadOfficeState();

    // Helper to reactively update workstation screen glow on occupant state change
    const syncWorkstationOccupantState = (agentId: string, nextState: CanonicalAgentState) => {
      setWorkstations((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const wsId in next) {
          if (next[wsId].assigned_employee === agentId && next[wsId].occupant_state !== nextState) {
            next[wsId] = { ...next[wsId], occupant_state: nextState };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    // Subscribe to SyncManager real-time events
    const unsubEvent = syncManager.onEvent((envelope: EventEnvelope) => {
      if (!isMountedRef.current) return;

      const { event_type, agent_id, sequence_id: evSeq, payload } = envelope;

      // Update monotonic sequence watermark
      if (evSeq && evSeq > 0) {
        latestSequenceRef.current = Math.max(latestSequenceRef.current, evSeq);
        setSequenceId(latestSequenceRef.current);
      }

      // Handle Agent Behavioral State and Operational Changes
      if (
        event_type === "agent.behavioral_state_changed" ||
        event_type === "agent.status_changed"
      ) {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            const nextBehavioral = (normalizeBehavioralState(
              payload?.behavioral_state,
              payload?.operational_status
            ) as CanonicalAgentState) || current.behavioralState;

            syncWorkstationOccupantState(targetId, nextBehavioral);

            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: nextBehavioral,
                operationalStatus: payload?.operational_status || current.operationalStatus,
                currentTaskTitle:
                  nextBehavioral === "IDLE" || nextBehavioral === "COMPLETED"
                    ? null
                    : payload?.reason || current.currentTaskTitle,
              },
            };
          });
        }
      }

      // Handle Agent Movement
      else if (event_type === "agent.movement_started") {
        const targetId = payload?.agent_id || agent_id;
        const targetPos = payload?.target_position;
        if (targetId && targetPos) {
          const tx =
            typeof targetPos.x === "number"
              ? targetPos.x
              : Array.isArray(targetPos)
              ? targetPos[0]
              : 0;
          const ty =
            typeof targetPos.y === "number"
              ? targetPos.y
              : Array.isArray(targetPos)
              ? targetPos[1]
              : 1;
          const tz =
            typeof targetPos.z === "number"
              ? targetPos.z
              : Array.isArray(targetPos)
              ? targetPos[2]
              : 0;

          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "ASSIGNED");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "ASSIGNED",
                targetPosition: [tx, ty, tz],
                isMoving: true,
                waypoints: Array.isArray(payload?.waypoints) ? payload.waypoints : undefined,
              },
            };
          });
        }
      } else if (event_type === "agent.movement_progress") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId && payload?.position) {
          const px =
            typeof payload.position.x === "number"
              ? payload.position.x
              : Array.isArray(payload.position)
              ? payload.position[0]
              : undefined;
          const py =
            typeof payload.position.y === "number"
              ? payload.position.y
              : Array.isArray(payload.position)
              ? payload.position[1]
              : 1;
          const pz =
            typeof payload.position.z === "number"
              ? payload.position.z
              : Array.isArray(payload.position)
              ? payload.position[2]
              : undefined;
          if (typeof px === "number" && typeof pz === "number") {
            setAgents((prev) => {
              const current = prev[targetId];
              if (!current) return prev;
              return {
                ...prev,
                [targetId]: {
                  ...current,
                  position: [px, py, pz],
                },
              };
            });
          }
        }
      } else if (event_type === "agent.movement_completed") {
        const targetId = payload?.agent_id || agent_id;
        const finalPos = payload?.position;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            const finalState = (payload?.behavioral_state as CanonicalAgentState) || "IDLE";
            syncWorkstationOccupantState(targetId, finalState);
            const fx =
              typeof finalPos?.x === "number"
                ? finalPos.x
                : Array.isArray(finalPos)
                ? finalPos[0]
                : current.position[0];
            const fy =
              typeof finalPos?.y === "number"
                ? finalPos.y
                : Array.isArray(finalPos)
                ? finalPos[1]
                : current.position[1];
            const fz =
              typeof finalPos?.z === "number"
                ? finalPos.z
                : Array.isArray(finalPos)
                ? finalPos[2]
                : current.position[2];

            return {
              ...prev,
              [targetId]: {
                ...current,
                position: [fx, fy, fz],
                targetPosition: null,
                waypoints: undefined,
                isMoving: false,
                behavioralState: finalState,
              },
            };
          });
        }
      } else if (event_type === "agent.movement_interrupted") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            const stopPos = payload?.position;
            const sx =
              typeof stopPos?.x === "number"
                ? stopPos.x
                : Array.isArray(stopPos)
                ? stopPos[0]
                : current.position[0];
            const sy =
              typeof stopPos?.y === "number"
                ? stopPos.y
                : Array.isArray(stopPos)
                ? stopPos[1]
                : current.position[1];
            const sz =
              typeof stopPos?.z === "number"
                ? stopPos.z
                : Array.isArray(stopPos)
                ? stopPos[2]
                : current.position[2];

            return {
              ...prev,
              [targetId]: {
                ...current,
                position: [sx, sy, sz],
                targetPosition: null,
                waypoints: undefined,
                isMoving: false,
                behavioralState: "IDLE",
              },
            };
          });
        }
      }

      // Handle Task Lifecycle and Tool Executions
      else if (event_type === "tool.execution_started") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "IN_PROGRESS");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "IN_PROGRESS",
                currentTaskTitle: `Đang chạy công cụ: ${payload?.tool_name || "Tool"}`,
              },
            };
          });
        }
      } else if (event_type === "task.completed" || event_type === "subtask.completed") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "COMPLETED");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "COMPLETED",
                currentTaskTitle: null,
              },
            };
          });
        }
      } else if (event_type === "task.paused") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "PAUSED");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "PAUSED",
                currentTaskTitle: `Tạm dừng: ${payload?.reason || current.currentTaskTitle}`,
              },
            };
          });
        }
      } else if (event_type === "task.resumed") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "IN_PROGRESS");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "IN_PROGRESS",
                currentTaskTitle: payload?.title || current.currentTaskTitle,
              },
            };
          });
        }
      } else if (event_type === "approval.created") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "WAITING_APPROVAL");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "WAITING_APPROVAL",
                currentTaskTitle: `Chờ duyệt: ${payload?.action_type || "Protected action"}`,
              },
            };
          });
        }
      } else if (
        event_type === "approval.decided" ||
        event_type === "approval.approved"
      ) {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "IN_PROGRESS");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "IN_PROGRESS",
              },
            };
          });
        }
      } else if (event_type === "task.failed" || event_type === "subtask.failed") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            syncWorkstationOccupantState(targetId, "FAILED");
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "FAILED",
                currentTaskTitle: `Lỗi: ${payload?.error_message || "Thất bại"}`,
              },
            };
          });
        }
      }
    });

    // Connection state listeners
    const unsubState = syncManager.onStateChange((state, error) => {
      if (!isMountedRef.current) return;
      if (state === "CONNECTED") {
        setConnectionStatus("connected");
        // Re-hydrate authoritative state on reconnect
        if (latestSequenceRef.current > 0) {
          loadOfficeState();
        }
      } else if (state === "RECONNECTING") {
        setConnectionStatus("reconnecting");
      } else if (state === "ERROR") {
        setConnectionStatus("error");
        setErrorMessage(error || "Lỗi kết nối thời gian thực");
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubEvent();
      unsubState();
    };
  }, [organizationId, loadOfficeState]);

  const updateAgentPosition = useCallback((agentId: string, pos: [number, number, number]) => {
    setAgents((prev) => {
      const cur = prev[agentId];
      if (!cur) return prev;
      return {
        ...prev,
        [agentId]: {
          ...cur,
          position: pos,
        },
      };
    });
  }, []);

  return {
    organizationId,
    departments,
    workstations,
    agents,
    sequenceId,
    connectionStatus,
    isLoading,
    errorMessage,
    refresh: loadOfficeState,
    updateAgentPosition,
  };
}
