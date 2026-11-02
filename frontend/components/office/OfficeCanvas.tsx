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
import { WorkstationData } from "./Workstation";
import { OfficeSelection } from "@/types/office";

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
}: OfficeCanvasProps) {
  const selectedAgentId = selection.type === "agent" ? selection.id : null;
  const selectedWorkstationId =
    selection.type === "workstation"
      ? selection.id
      : selection.type === "agent"
      ? Object.values(workstations).find((w) => w.assigned_employee === selection.id)?.workstation_id ?? null
      : null;
  const selectedDeptName = selection.type === "department" ? selection.id : null;

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

          {/* Stateful Autonomous AI Agents */}
          {Object.values(agents).map((agent) => (
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

