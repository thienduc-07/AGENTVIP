"use client";

import React, { useState, useCallback } from "react";
import OfficeCanvas from "./OfficeCanvas";
import OfficeHUD from "./OfficeHUD";
import OfficeInspector from "./OfficeInspector";
import AgentInspectionHUD from "./AgentInspectionHUD";
import EmptyOfficeState from "./EmptyOfficeState";
import MeetingHUD from "./MeetingHUD";
import MeetingDiscoveryModal from "./MeetingDiscoveryModal";
import { useOfficeSync } from "@/hooks/useOfficeSync";
import { useMeetingSync } from "@/hooks/useMeetingSync";
import { useMeetingStore } from "@/store/meetingStore";
import { OfficeSelection } from "@/types/office";

interface OfficeSceneProps {
  initialOrgId?: string;
  onToggleMissionDrawer?: () => void;
  isMissionDrawerOpen?: boolean;
  onOpenTaskModal?: () => void;
  onOpenRecruitmentModal?: () => void;
}

const TACTICAL_OVERVIEW_POS: [number, number, number] = [0, 26, 32];
const TACTICAL_OVERVIEW_LOOK: [number, number, number] = [0, 0, 4];

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

  const [selection, setSelection] = useState<OfficeSelection>({ type: "none" });
  const [cameraPosition, setCameraPosition] = useState<[number, number, number]>(TACTICAL_OVERVIEW_POS);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number]>(TACTICAL_OVERVIEW_LOOK);
  const [isMeetingDiscoveryOpen, setIsMeetingDiscoveryOpen] = useState(false);
  const [isMeetingViewActive, setMeetingViewActive] = useState(false);

  // 1. Selection Handlers
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

      if (ws.assigned_employee) {
        // Occupied workstation: select corresponding agent to open the Agent Inspection HUD
        setSelection({ type: "agent", id: ws.assigned_employee });
        setCameraTarget([ws.pos_x, 0.8, ws.pos_z]);
        setCameraPosition([ws.pos_x + 3.8, 3.2, ws.pos_z + 4.8]);
      } else {
        // Unoccupied workstation: view workstation without fabricating an agent
        setSelection({ type: "workstation", id: workstationId });
        setCameraTarget([ws.pos_x, 0.8, ws.pos_z]);
        setCameraPosition([ws.pos_x + 3.8, 3.2, ws.pos_z + 4.8]);
      }
    },
    [workstations]
  );

  const handleFocusWorkstation = useCallback(
    (workstationId: string) => {
      const ws = workstations[workstationId];
      if (!ws) return;
      setCameraTarget([ws.pos_x, 0.8, ws.pos_z]);
      setCameraPosition([ws.pos_x + 3.8, 3.2, ws.pos_z + 4.8]);
    },
    [workstations]
  );

  const handleSelectDepartment = useCallback(
    (deptName: string) => {
      const dept = departments[deptName];
      if (!dept) return;

      setSelection({ type: "department", id: deptName });
      setCameraTarget([dept.base_x, 0.5, dept.base_z]);
      setCameraPosition([dept.base_x, 14, dept.base_z + 12]);
    },
    [departments]
  );

  const handleResetCamera = useCallback(() => {
    setSelection({ type: "none" });
    setMeetingViewActive(false);
    setCameraPosition(TACTICAL_OVERVIEW_POS);
    setCameraTarget(TACTICAL_OVERVIEW_LOOK);
  }, []);

  const handleFocusCEO = useCallback(() => {
    // Focus on Executive Suite at (0, 1.2, -12)
    setMeetingViewActive(false);
    setCameraTarget([0, 1.2, -12]);
    setCameraPosition([0, 7.5, -4]);
  }, []);

  // Phase 4.3.5: Meeting Camera Navigation
  const handleEnterMeetingView = useCallback(() => {
    setSelection({ type: "meeting_room" });
    setMeetingViewActive(true);
    setMeetingHUDOpen(true);
    setCameraTarget([0, 1.3, 3.5]);
    setCameraPosition([0, 4.2, 8.4]);
  }, [setMeetingHUDOpen]);

  const handleExitMeetingView = useCallback(() => {
    setSelection({ type: "none" });
    setMeetingViewActive(false);
    setCameraPosition(TACTICAL_OVERVIEW_POS);
    setCameraTarget(TACTICAL_OVERVIEW_LOOK);
  }, []);

  const handleFocusMeetingDisplay = useCallback(() => {
    setSelection({ type: "meeting_display" });
    setMeetingViewActive(true);
    setMeetingHUDOpen(true);
    setCameraTarget([0, 1.85, 0.5]);
    setCameraPosition([0, 2.3, 3.2]);
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
        cameraPosition={cameraPosition}
        cameraTarget={cameraTarget}
        onSelectAgent={handleSelectAgent}
        onSelectWorkstation={handleSelectWorkstation}
        onSelectDepartment={handleSelectDepartment}
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
