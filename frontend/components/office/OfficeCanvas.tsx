"use client";

import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import OfficeEnvironment from "./OfficeEnvironment";
import OfficeFloor from "./OfficeFloor";
import OfficeLighting from "./OfficeLighting";
import OfficeCamera from "./OfficeCamera";
import DepartmentZone, { DepartmentZoneData } from "./DepartmentZone";
import AgentAvatar, { AgentAvatarData } from "./AgentAvatar";
import MeetingRoom from "./MeetingRoom";
import { WorkstationData } from "./Workstation";
import { OfficeSelection } from "@/types/office";
import { useMeetingStore } from "@/store/meetingStore";

interface OfficeCanvasProps {
  departments: Record<string, DepartmentZoneData>;
  workstations: Record<string, WorkstationData>;
  agents: Record<string, AgentAvatarData>;
  selection: OfficeSelection;
  cameraTarget?: [number, number, number];
  cameraPosition?: [number, number, number];
  onSelectAgent: (id: string) => void;
  onSelectWorkstation: (id: string) => void;
  onSelectDepartment: (name: string) => void;
  onPointerMissed: () => void;
  onEnterMeetingView?: () => void;
  onSelectMeetingChair?: (seatIndex: number, agentId?: string) => void;
  onSelectMeetingDisplay?: () => void;
}

export default function OfficeCanvas({
  departments,
  workstations,
  agents,
  selection,
  cameraTarget = [0, 0, 4],
  cameraPosition = [0, 26, 32],
  onSelectAgent,
  onSelectWorkstation,
  onSelectDepartment,
  onPointerMissed,
  onEnterMeetingView,
  onSelectMeetingChair,
  onSelectMeetingDisplay,
}: OfficeCanvasProps) {
  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const seatAssignments = useMeetingStore((s) => s.seatAssignments);
  const currentSpeakerId = useMeetingStore((s) => s.currentSpeakerId);
  const presentationMode = useMeetingStore((s) => s.presentationMode);

  const selectedAgentId = selection.type === "agent" ? selection.id : null;
  const selectedWorkstationId =
    selection.type === "workstation"
      ? selection.id
      : selection.type === "agent"
      ? Object.values(workstations).find((w) => w.assigned_employee === selection.id)?.workstation_id ?? null
      : null;
  const selectedDeptName = selection.type === "department" ? selection.id : null;

  // Resolve dynamic avatar state overlaying meeting participation
  const renderedAgents = React.useMemo(() => {
    const isMeetingActive =
      activeMeeting &&
      (activeMeeting.status === "IN_PROGRESS" ||
        activeMeeting.status === "PAUSED" ||
        activeMeeting.status === "WAITING_APPROVAL");

    const result: Record<string, AgentAvatarData> = { ...agents };

    if (isMeetingActive) {
      Object.entries(seatAssignments).forEach(([agentId, seat]) => {
        const existing = result[agentId];
        const seatedWorldPos: [number, number, number] = [
          seat.position[0],
          seat.position[1] + 0.38,
          seat.position[2] + 3.5,
        ];
        const mState =
          currentSpeakerId === agentId
            ? "SPEAKING"
            : presentationMode === "VOTING"
            ? "VOTING"
            : "LISTENING";

        if (existing) {
          result[agentId] = {
            ...existing,
            position: seatedWorldPos,
            headingRadians: seat.rotationY,
            isSeated: true,
            meetingState: mState,
          };
        } else {
          // Provide visual avatar for participant not previously in world snapshot
          const partInfo = activeMeeting.participants.find((p) => p.agent_id === agentId);
          result[agentId] = {
            id: agentId,
            name: partInfo?.agent_name || agentId,
            role: partInfo?.role || "SPECIALIST",
            department: "Executive",
            position: seatedWorldPos,
            headingRadians: seat.rotationY,
            behavioralState: "IN_PROGRESS",
            isSeated: true,
            meetingState: mState,
          };
        }
      });
    }

    return result;
  }, [agents, activeMeeting, seatAssignments, currentSpeakerId, presentationMode]);

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        camera={{
          position: cameraPosition,
          fov: 46,
          near: 0.5,
          far: 250,
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
        }}
        onPointerMissed={onPointerMissed}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        <color attach="background" args={["#090d16"]} />
        <fog attach="fog" args={["#090d16", 45, 160]} />

        <Suspense fallback={null}>
          {/* Architectural Lighting Setup */}
          <OfficeLighting />

          {/* Panoramic Skyline & Perimeter Walls */}
          <OfficeEnvironment />

          {/* Luxury Terrazzo Architectural Floor & Corridors */}
          <OfficeFloor />

          {/* Dynamic Department Zones with Child Workstations */}
          {Object.values(departments).map((dept) => (
            <DepartmentZone
              key={dept.department}
              data={dept}
              isSelected={selectedDeptName === dept.department}
              selectedWorkstationId={selectedWorkstationId}
              onSelectDepartment={onSelectDepartment}
              onSelectWorkstation={onSelectWorkstation}
            />
          ))}

          {/* 3D Glass Conference Pavilion & Meeting Room */}
          <MeetingRoom
            position={[0, 0, 3.5]}
            onEnterMeetingView={onEnterMeetingView}
            onSelectChair={onSelectMeetingChair}
            onSelectDisplay={onSelectMeetingDisplay}
          />

          {/* Stateful Autonomous AI Agents */}
          {Object.values(renderedAgents).map((agent) => (
            <AgentAvatar
              key={agent.id}
              data={agent}
              isSelected={selectedAgentId === agent.id}
              onSelect={onSelectAgent}
            />
          ))}

          {/* Visual Destination Marker for Selected Moving Agent */}
          {selectedAgentId &&
            agents[selectedAgentId]?.isMoving &&
            agents[selectedAgentId]?.targetPosition && (
              <group
                position={[
                  agents[selectedAgentId].targetPosition![0],
                  0.015,
                  agents[selectedAgentId].targetPosition![2],
                ]}
              >
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.5, 0.68, 32]} />
                  <meshBasicMaterial color="#38bdf8" transparent opacity={0.75} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.18, 16]} />
                  <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} />
                </mesh>
              </group>
            )}

          {/* Smooth Lerp Camera Orbit Controller */}
          <OfficeCamera
            targetPosition={cameraPosition}
            targetLookAt={cameraTarget}
            isTransitioning={selection.type !== "none"}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

