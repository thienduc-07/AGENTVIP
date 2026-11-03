"use client";

import React, { useState, useCallback } from "react";
import OfficeCanvas from "./OfficeCanvas";
import OfficeHUD from "./OfficeHUD";
import OfficeInspector from "./OfficeInspector";
import AgentInspectionHUD from "./AgentInspectionHUD";
import EmptyOfficeState from "./EmptyOfficeState";
import MeetingHUD from "./MeetingHUD";
import MeetingDiscoveryModal from "./MeetingDiscoveryModal";
import WorkstationScreen from "./workstation/WorkstationScreen";
import { useOfficeSync } from "@/hooks/useOfficeSync";
import { useMeetingSync } from "@/hooks/useMeetingSync";
import { useMeetingStore } from "@/store/meetingStore";
import { useWorkstationStore } from "@/store/workstationStore";
import { OfficeSelection } from "@/types/office";

interface OfficeSceneProps {
  initialOrgId?: string;
  onToggleMissionDrawer?: () => void;
  isMissionDrawerOpen?: boolean;
  onOpenTaskModal?: () => void;
  onOpenRecruitmentModal?: () => void;
}

export const FLOOR_CAMERA_PRESETS: Record<number, { pos: [number, number, number]; look: [number, number, number] }> = {
  0: { pos: [0, 24, 46], look: [0, 16, 0] },       // Overview (All 6 Floors Dollhouse Cutaway)
  1: { pos: [0, 5.5, 20], look: [0, 1.5, 0] },     // Floor 1: Reception & Operations
  2: { pos: [0, 11.5, 20], look: [0, 7.5, 0] },    // Floor 2: Design & Creative
  3: { pos: [0, 17.5, 20], look: [0, 13.5, 0] },   // Floor 3: Marketing & Growth
  4: { pos: [0, 23.5, 20], look: [0, 19.5, 0] },   // Floor 4: Research & Data Science
  5: { pos: [0, 29.5, 20], look: [0, 25.5, 0] },   // Floor 5: Engineering & Architecture
  6: { pos: [0, 35.5, 20], look: [0, 31.5, 0] },   // Floor 6: Executive Penthouse & Boardroom
};

export default function OfficeScene({
  initialOrgId = "org_default_company",
  onToggleMissionDrawer,
  isMissionDrawerOpen,
  onOpenTaskModal,
  onOpenRecruitmentModal,
}: OfficeSceneProps) {
  const {
    organizationId,
    departments,
    workstations,
    agents,
    sequenceId,
    connectionStatus,
    isLoading,
    errorMessage,
    refresh,
  } = useOfficeSync(initialOrgId);

  // Phase 4.3.5: Real-time meeting sync
  useMeetingSync(organizationId);

  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const isMeetingHUDOpen = useMeetingStore((s) => s.isMeetingHUDOpen);
  const setMeetingHUDOpen = useMeetingStore((s) => s.setMeetingHUDOpen);
  const isWorkstationScreenOpen = useWorkstationStore((s) => s.isWorkstationScreenOpen);

  const [selection, setSelection] = useState<OfficeSelection>({ type: "none" });
  const [activeFloor, setActiveFloor] = useState<number>(0);
  const [isFloorIsolated, setIsFloorIsolated] = useState<boolean>(false);
  const [cameraPosition, setCameraPosition] = useState<[number, number, number]>(FLOOR_CAMERA_PRESETS[0].pos);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number]>(FLOOR_CAMERA_PRESETS[0].look);
  const [isMeetingDiscoveryOpen, setIsMeetingDiscoveryOpen] = useState(false);
  const [isMeetingViewActive, setMeetingViewActive] = useState(false);

  // 1. Floor Navigation Handlers
  const handleSelectFloor = useCallback((floorNum: number) => {
    setActiveFloor(floorNum);
    const preset = FLOOR_CAMERA_PRESETS[floorNum] || FLOOR_CAMERA_PRESETS[0];
    setCameraPosition(preset.pos);
    setCameraTarget(preset.look);
    if (floorNum === 0) {
      setSelection({ type: "none" });
    } else {
      setSelection({ type: "floor", id: `floor_${floorNum}` });
    }
  }, []);

  const handleToggleIsolation = useCallback(() => {
    setIsFloorIsolated((prev) => !prev);
  }, []);

  // 2. Selection Handlers
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      const agent = agents[agentId];
      if (!agent) return;

      setSelection({ type: "agent", id: agentId });
      // Smoothly zoom in on the agent
      setCameraTarget([agent.position[0], agent.position[1] + 1.0, agent.position[2]]);
      setCameraPosition([agent.position[0] + 4.5, agent.position[1] + 2.8, agent.position[2] + 5.5]);
    },
    [agents]
  );

  const handleSelectWorkstation = useCallback(
    (workstationId: string) => {
      const ws = workstations[workstationId];
      if (!ws) return;

      const wsElevation = ws.pos_y || 0;
      if (ws.assigned_employee) {
        // Occupied workstation: select corresponding agent to open the Agent Inspection HUD
        setSelection({ type: "agent", id: ws.assigned_employee });
        setCameraTarget([ws.pos_x, wsElevation + 0.8, ws.pos_z]);
        setCameraPosition([ws.pos_x + 3.8, wsElevation + 3.2, ws.pos_z + 4.8]);
      } else {
        // Unoccupied workstation: view workstation without fabricating an agent
        setSelection({ type: "workstation", id: workstationId });
        setCameraTarget([ws.pos_x, wsElevation + 0.8, ws.pos_z]);
        setCameraPosition([ws.pos_x + 3.8, wsElevation + 3.2, ws.pos_z + 4.8]);
      }
    },
    [workstations]
  );

  const handleFocusWorkstation = useCallback(
    (workstationId: string) => {
      const ws = workstations[workstationId];
      if (!ws) return;
      const wsElevation = ws.pos_y || 0;
      setCameraTarget([ws.pos_x, wsElevation + 0.8, ws.pos_z]);
      setCameraPosition([ws.pos_x + 3.8, wsElevation + 3.2, ws.pos_z + 4.8]);
    },
    [workstations]
  );

  const handleSelectDepartment = useCallback(
    (deptName: string) => {
      const dept = departments[deptName];
      if (!dept) return;

      const deptElevation = dept.base_y || 0;
      setSelection({ type: "department", id: deptName });
      setCameraTarget([dept.base_x, deptElevation + 0.5, dept.base_z]);
      setCameraPosition([dept.base_x, deptElevation + 10, dept.base_z + 10]);
    },
    [departments]
  );

  const handleResetCamera = useCallback(() => {
    setSelection({ type: "none" });
    setMeetingViewActive(false);
    setActiveFloor(0);
    setCameraPosition(FLOOR_CAMERA_PRESETS[0].pos);
    setCameraTarget(FLOOR_CAMERA_PRESETS[0].look);
  }, []);

  const handleFocusCEO = useCallback(() => {
    // Focus on Executive Penthouse CEO Suite on Floor 6 at (-9, 31.2, -3)
    setMeetingViewActive(false);
    setActiveFloor(6);
    setCameraTarget([-9.0, 31.2, -3.0]);
    setCameraPosition([-9.0, 33.5, 4.5]);
  }, []);

  // Phase 4.3.5: Meeting Camera Navigation
  const handleEnterMeetingView = useCallback(() => {
    setSelection({ type: "meeting_room" });
    setMeetingViewActive(true);
    setMeetingHUDOpen(true);
    setActiveFloor(6);
    setCameraTarget([4.5, 31.3, 0]);
    setCameraPosition([4.5, 34.2, 8.4]);
  }, [setMeetingHUDOpen]);

  const handleExitMeetingView = useCallback(() => {
    setSelection({ type: "none" });
    setMeetingViewActive(false);
    setCameraPosition(FLOOR_CAMERA_PRESETS[0].pos);
    setCameraTarget(FLOOR_CAMERA_PRESETS[0].look);
  }, []);

  const handleFocusMeetingDisplay = useCallback(() => {
    setSelection({ type: "meeting_display" });
    setMeetingViewActive(true);
    setMeetingHUDOpen(true);
    setActiveFloor(6);
    setCameraTarget([4.5, 31.85, -3.8]);
    setCameraPosition([4.5, 32.3, -1.0]);
  }, [setMeetingHUDOpen]);

  const handleSelectMeetingChair = useCallback(
    (seatIndex: number, agentId?: string) => {
      if (agentId) {
        handleSelectAgent(agentId);
      } else {
        handleEnterMeetingView();
      }
    },
    [handleSelectAgent, handleEnterMeetingView]
  );

  // Compute telemetry metrics
  const totalAgents = Object.keys(agents).length;
  const totalWorkstations = Object.keys(workstations).length;
  const occupiedWorkstations = Object.values(workstations).filter((w) => w.assigned_employee).length;
  const activeTasksCount = Object.values(agents).filter((a) => a.behavioralState === "IN_PROGRESS").length;
  const isEmptyOrg = !isLoading && totalAgents === 0 && Object.keys(departments).length === 0;

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden select-none">
      {/* Top HUD Telemetry Bar */}
      <OfficeHUD
        organizationId={organizationId}
        connectionStatus={connectionStatus}
        sequenceId={sequenceId}
        totalAgents={totalAgents}
        activeTasksCount={activeTasksCount}
        totalWorkstations={totalWorkstations}
        occupiedWorkstations={occupiedWorkstations}
        activeFloor={activeFloor}
        isFloorIsolated={isFloorIsolated}
        onSelectFloor={handleSelectFloor}
        onToggleIsolation={handleToggleIsolation}
        onResetCamera={handleResetCamera}
        onFocusCEO={handleFocusCEO}
        onFocusMeetingRoom={handleEnterMeetingView}
        onOpenMeetingDiscovery={() => setIsMeetingDiscoveryOpen(true)}
        onRefreshData={refresh}
        onToggleMissionDrawer={onToggleMissionDrawer}
        isMissionDrawerOpen={isMissionDrawerOpen}
        onOpenTaskModal={onOpenTaskModal}
        onOpenRecruitmentModal={onOpenRecruitmentModal}
      />

      {/* 3D WebGL Canvas Viewport */}
      <OfficeCanvas
        departments={departments}
        workstations={workstations}
        agents={agents}
        selection={selection}
        activeFloor={activeFloor}
        isFloorIsolated={isFloorIsolated}
        cameraPosition={cameraPosition}
        cameraTarget={cameraTarget}
        onSelectAgent={handleSelectAgent}
        onSelectWorkstation={handleSelectWorkstation}
        onSelectDepartment={handleSelectDepartment}
        onSelectFloor={handleSelectFloor}
        onPointerMissed={handleResetCamera}
        onEnterMeetingView={handleEnterMeetingView}
        onSelectMeetingChair={handleSelectMeetingChair}
        onSelectMeetingDisplay={handleFocusMeetingDisplay}
      />

      {/* Agent Inspection HUD (when an agent is selected) */}
      {selection.type === "agent" && (
        <AgentInspectionHUD
          agentId={selection.id}
          onClose={() => setSelection({ type: "none" })}
          onFocusWorkstation={handleFocusWorkstation}
          onFocusAgent={handleSelectAgent}
        />
      )}

      {/* Office Inspector Drawer (when workstation or department is selected) */}
      {(selection.type === "workstation" || selection.type === "department") && (
        <OfficeInspector
          selection={selection}
          agents={agents}
          workstations={workstations}
          departments={departments}
          onClose={() => setSelection({ type: "none" })}
          onFocusAgent={handleSelectAgent}
          onFocusDepartment={handleSelectDepartment}
        />
      )}

      {/* Phase 4.3.5: Interactive Meeting HUD */}
      {(isMeetingViewActive || selection.type === "meeting_room" || selection.type === "meeting_display" || isMeetingHUDOpen) && (
        <MeetingHUD
          organizationId={organizationId}
          onExitMeetingView={handleExitMeetingView}
          onFocusParticipant={handleSelectAgent}
          onFocusDisplay={handleFocusMeetingDisplay}
          onOpenDiscovery={() => setIsMeetingDiscoveryOpen(true)}
        />
      )}

      {/* Phase 4.3.5: Meeting Discovery & Creation Modal */}
      <MeetingDiscoveryModal
        organizationId={organizationId}
        isOpen={isMeetingDiscoveryOpen}
        onClose={() => setIsMeetingDiscoveryOpen(false)}
        onSelectMeeting={() => {
          setIsMeetingDiscoveryOpen(false);
          handleEnterMeetingView();
        }}
      />

      {/* Phase 4.3.6: Workstation Screen & Live Terminal Modal */}
      {isWorkstationScreenOpen && (
        <WorkstationScreen organizationId={organizationId} />
      )}

      {/* Empty Organization State Overlay */}
      {isEmptyOrg && (
        <EmptyOfficeState
          organizationId={organizationId}
          onRefresh={refresh}
        />
      )}

      {/* Loading Screen Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-sky-500/20 border-t-sky-400 rounded-full animate-spin" />
            <p className="text-xs font-semibold text-slate-300 tracking-wider uppercase animate-pulse">
              Đang tải không gian văn phòng 3D...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
