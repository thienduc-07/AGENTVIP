"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getWorldSnapshot } from "@/lib/api/world";
import { getWorkstationOverview, ZoneConfig, WorkstationAllocation } from "@/lib/api/workstations";
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

  // 1. Initial Authoritative Hydration from REST APIs
  const loadOfficeState = useCallback(async () => {
    setIsLoading(true);
    setConnectionStatus("connecting");
    setErrorMessage(null);

    try {
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

      // Process World Snapshot
      if (snapshotRes.status === "fulfilled" && snapshotRes.value) {
        const snap = snapshotRes.value;
        currentSeq = snap.sequence_id || 0;
        setSequenceId(currentSeq);

        // Map agents
        (snap.agents || []).forEach((item) => {
          const bState = (normalizeBehavioralState(
            item.behavioral_state,
            item.operational_status as any
          ) as CanonicalAgentState) || "IDLE";

          const coords = item.spatial_coordinates;
          const targetCoords = item.target_coordinates;

          loadedAgents[item.employee_id] = {
            id: item.employee_id,
            name: item.name,
            role: item.role,
            department: item.department,
            position: [coords?.x ?? 0, coords?.y ?? 1, coords?.z ?? 0],
            targetPosition: targetCoords
              ? [targetCoords.x, targetCoords.y, targetCoords.z]
              : null,
            behavioralState: bState,
            operationalStatus: item.operational_status,
            currentTaskTitle: item.current_active_task?.title ?? null,
            assignedWorkstation: item.assigned_workstation ?? null,
            isMoving: Boolean(item.active_movement_id || targetCoords),
          };
        });

        // Map snapshot workstations if present
        (snap.workstations || []).forEach((ws) => {
          loadedWorkstations[ws.workstation_id] = {
            workstation_id: ws.workstation_id,
            zone: ws.zone,
            label: ws.label || ws.workstation_id,
            department: ws.zone,
            desk_number: null,
            pos_x: ws.spatial_coordinates.x ?? 0,
            pos_y: ws.spatial_coordinates.y ?? 1,
            pos_z: ws.spatial_coordinates.z ?? 0,
            occupancy_status: ws.occupancy_status || "vacant",
            assigned_employee: ws.assigned_employee,
            is_virtual: ws.is_virtual ?? false,
          };
        });
      }

      // Process Workstation Overview (Zones and Allocations)
      if (workstationRes.status === "fulfilled" && workstationRes.value) {
        const wsOverview = workstationRes.value;
        const allocations = wsOverview.allocations || [];
        const zones = wsOverview.zones || [];

        // Build workstation dictionary from authoritative allocations
        allocations.forEach((alloc: WorkstationAllocation) => {
          const occupant = loadedAgents[alloc.agent_id];
          const wsKey = alloc.logical_workstation_id || alloc.id;

          loadedWorkstations[wsKey] = {
            workstation_id: wsKey,
            zone: alloc.office_zone || alloc.department,
            label: `Bàn #${alloc.desk_number ?? "V"}-${alloc.department}`,
            department: alloc.department,
            desk_number: alloc.desk_number,
            pos_x: alloc.pos_x ?? 0,
            pos_y: alloc.pos_y ?? 1,
            pos_z: alloc.pos_z ?? 0,
            occupancy_status: alloc.allocation_status === "ASSIGNED" ? "occupied" : "vacant",
            assigned_employee: alloc.agent_id,
            assigned_employee_name: alloc.agent_name || occupant?.name,
            assigned_employee_role: alloc.agent_role || occupant?.role,
            occupant_state: occupant?.behavioralState || "IDLE",
            is_virtual: alloc.is_virtual,
          };

          // Attach workstation reference back to agent
          if (occupant) {
            occupant.assignedWorkstation = wsKey;
          }
        });

        // Build department zones
        zones.forEach((zone: ZoneConfig) => {
          const deptName = zone.department;
          const spacing = DEFAULT_ZONE_SPACING[deptName] || { x: zone.desk_spacing_x || 2.2, z: zone.desk_spacing_z || 2.0 };

          // Gather workstations belonging to this department
          const deptWorkstations = Object.values(loadedWorkstations).filter(
            (w) => w.department === deptName
          );

          loadedDepartments[deptName] = {
            department: deptName,
            zone: zone.zone,
            base_x: zone.base_x,
            base_y: zone.base_y,
            base_z: zone.base_z,
            max_physical_desks: zone.max_physical_desks || 8,
            desk_spacing_x: spacing.x,
            desk_spacing_z: spacing.z,
            workstations: deptWorkstations,
          };
        });
      }

      setAgents(loadedAgents);
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
    loadOfficeState();

    // Subscribe to SyncManager real-time events
    const unsubEvent = syncManager.onEvent((envelope: EventEnvelope) => {
      if (!isMountedRef.current) return;

      const { event_type, agent_id, sequence_id: evSeq, payload } = envelope;

      // Update monotonic sequence watermark
      if (evSeq && evSeq > 0) {
        setSequenceId((prev) => Math.max(prev, evSeq));
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
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            return {
              ...prev,
              [targetId]: {
                ...current,
                behavioralState: "ASSIGNED",
                targetPosition: [targetPos[0], targetPos[1], targetPos[2]],
                isMoving: true,
              },
            };
          });
        }
      } else if (event_type === "agent.movement_completed") {
        const targetId = payload?.agent_id || agent_id;
        const finalPos = payload?.position;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
            return {
              ...prev,
              [targetId]: {
                ...current,
                position: finalPos ? [finalPos[0], finalPos[1], finalPos[2]] : current.position,
                targetPosition: null,
                isMoving: false,
                behavioralState: (payload?.behavioral_state as CanonicalAgentState) || "IDLE",
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
      } else if (event_type === "task.failed" || event_type === "subtask.failed") {
        const targetId = payload?.agent_id || agent_id;
        if (targetId) {
          setAgents((prev) => {
            const current = prev[targetId];
            if (!current) return prev;
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
