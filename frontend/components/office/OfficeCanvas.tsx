"use client";

import React, { Suspense, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import OfficeEnvironment from "./OfficeEnvironment";
import OfficeFloor from "./OfficeFloor";
import OfficeLighting from "./OfficeLighting";
import OfficeCamera from "./OfficeCamera";
import DepartmentZone, { DepartmentZoneData } from "./DepartmentZone";
import AgentAvatar, { AgentAvatarData } from "./AgentAvatar";
import InstancedWorkstations from "./InstancedWorkstations";
import InstancedAgents from "./InstancedAgents";
import MeetingRoom from "./MeetingRoom";
import CorporateBuilding from "./CorporateBuilding";
import FloorInteriors from "./FloorInteriors";
import { WorkstationData } from "./Workstation";
import { OfficeSelection } from "@/types/office";
import { useMeetingStore } from "@/store/meetingStore";
import { getDepartmentFloor } from "@/hooks/useOfficeSync";

interface OfficeCanvasProps {
  departments: Record<string, DepartmentZoneData>;
  workstations: Record<string, WorkstationData>;
  agents: Record<string, AgentAvatarData>;
  selection: OfficeSelection;
  activeFloor?: number;
  isFloorIsolated?: boolean;
  cameraTarget?: [number, number, number];
  cameraPosition?: [number, number, number];
  onSelectAgent: (id: string) => void;
  onSelectWorkstation: (id: string) => void;
  onSelectDepartment: (name: string) => void;
  onSelectFloor?: (floor: number) => void;
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
  activeFloor = 0,
  isFloorIsolated = false,
  cameraTarget = [0, 16, 0],
  cameraPosition = [0, 24, 46],
  onSelectAgent,
  onSelectWorkstation,
  onSelectDepartment,
  onSelectFloor,
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
          seat.position[0] + 4.5,
          seat.position[1] + 30.0 + 0.38,
          seat.position[2],
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
    <div
      className="relative w-full h-full bg-sky-950 overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        camera={{
          position: cameraPosition,
          fov: 46,
          near: 0.5,
          far: 500,
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.25,
        }}
        onPointerMissed={onPointerMissed}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        <color attach="background" args={["#7dd3fc"]} />
        <fog attach="fog" args={["#cbe5f7", 100, 380]} />

        <Suspense fallback={null}>
          {/* Architectural Lighting Setup */}
          <OfficeLighting />

          {/* Panoramic Skyline & Ground Plaza */}
          <OfficeEnvironment />
          <OfficeFloor />

          {/* 6-Floor Multi-Story Architectural Headquarters */}
          <CorporateBuilding
            activeFloor={activeFloor}
            isFloorIsolated={isFloorIsolated}
            onSelectFloor={onSelectFloor}
          />

          {/* Architectural Interior Furniture, Partitions & Zone Features */}
          <FloorInteriors
            activeFloor={activeFloor}
            isFloorIsolated={isFloorIsolated}
          />

          {/* Dynamic Department Zones (Carpets, Glow Borders & Labels) */}
          {Object.values(departments).map((dept) => {
            const deptFloor = getDepartmentFloor(dept.department);
            const isVisible = !isFloorIsolated || activeFloor === 0 || deptFloor === activeFloor;
            if (!isVisible) return null;
            return (
              <DepartmentZone
                key={dept.department}
                data={dept}
                isSelected={selectedDeptName === dept.department}
                selectedWorkstationId={selectedWorkstationId}
                onSelectDepartment={onSelectDepartment}
                onSelectWorkstation={onSelectWorkstation}
              />
            );
          })}

          {/* High-Performance Instanced Workstations (Replaces 768 individual meshes with ~10 calls) */}
          <InstancedWorkstations
            workstations={workstations}
            selectedWorkstationId={selectedWorkstationId}
            activeFloor={activeFloor}
            isFloorIsolated={isFloorIsolated}
            onSelectWorkstation={onSelectWorkstation}
          />

          {/* 3D Glass Grand Executive Boardroom on Floor 6 */}
          {(!isFloorIsolated || activeFloor === 0 || activeFloor === 6) && (
            <MeetingRoom
              position={[4.5, 30.0, 0]}
              onEnterMeetingView={onEnterMeetingView}
              onSelectChair={onSelectMeetingChair}
              onSelectDisplay={onSelectMeetingDisplay}
            />
          )}

          {/* High-Performance Instanced Autonomous AI Agents (Replaces 1,600 meshes with ~10 calls) */}
          <InstancedAgents
            agents={renderedAgents}
            selectedAgentId={selectedAgentId}
            activeFloor={activeFloor}
            isFloorIsolated={isFloorIsolated}
            onSelectAgent={onSelectAgent}
          />

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

          {/* Real-time In-Engine Performance Profiler */}
          <ScenePerformanceMonitor />
        </Suspense>
      </Canvas>
    </div>
  );
}

function ScenePerformanceMonitor() {
  const { gl, scene, camera } = useThree();
  const fpsRef = useRef<number>(60);
  const frameTimes = useRef<number[]>([]);
  const lastTime = useRef<number>(performance.now());
  const reactRenderCount = useRef<number>(0);
  const activeMeasure = useRef<{ start: number; frames: number; deltas: number[] } | null>(null);

  useEffect(() => {
    reactRenderCount.current += 1;
  });

  useFrame(() => {
    const now = performance.now();
    const delta = now - lastTime.current;
    lastTime.current = now;
    if (delta > 0) {
      frameTimes.current.push(1000 / delta);
      if (frameTimes.current.length > 60) frameTimes.current.shift();
      const sum = frameTimes.current.reduce((a, b) => a + b, 0);
      fpsRef.current = Math.round(sum / frameTimes.current.length);
    }
    if (activeMeasure.current) {
      activeMeasure.current.frames += 1;
      if (delta > 0 && delta < 5000) {
        activeMeasure.current.deltas.push(delta);
      }
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    (window as any).__AGENT_CITY_PROFILER__ = {
      startMeasure: () => {
        activeMeasure.current = { start: performance.now(), frames: 0, deltas: [] };
      },
      stopMeasure: (detailed = false) => {
        if (!activeMeasure.current) return detailed ? { fps: fpsRef.current } : fpsRef.current;
        const elapsed = (performance.now() - activeMeasure.current.start) / 1000;
        const fps = elapsed > 0 ? Math.round(activeMeasure.current.frames / elapsed) : fpsRef.current;
        const deltas = [...activeMeasure.current.deltas].sort((a, b) => a - b);
        activeMeasure.current = null;

        if (!detailed) return fps;
        if (deltas.length === 0) return { fps, frameCount: 0 };

        const totalMs = deltas.reduce((a, b) => a + b, 0);
        const avgFps = totalMs > 0 ? Math.round((deltas.length / (totalMs / 1000)) * 10) / 10 : fps;
        const median = Math.round(deltas[Math.floor(deltas.length * 0.5)] * 100) / 100;
        const p95 = Math.round(deltas[Math.floor(deltas.length * 0.95)] * 100) / 100;
        const p99 = Math.round(deltas[Math.floor(deltas.length * 0.99)] * 100) / 100;
        const onePercentLow = Math.round((1000 / Math.max(1, p99)) * 10) / 10;
        const longTasks = deltas.filter((d) => d > 50).length;
        const dropped = deltas.filter((d) => d > 16.67).length;

        return {
          fps,
          avgFps,
          frameCount: deltas.length,
          durationMs: Math.round(totalMs),
          medianFrameTimeMs: median,
          p95FrameTimeMs: p95,
          p99FrameTimeMs: p99,
          onePercentLowFps: onePercentLow,
          longTasksCount: longTasks,
          droppedFramesCount: dropped,
          minFrameTimeMs: Math.round(deltas[0] * 100) / 100,
          maxFrameTimeMs: Math.round(deltas[deltas.length - 1] * 100) / 100,
        };
      },
      getMetrics: () => {
        let meshCount = 0;
        const uniqueGeometries = new Set();
        const uniqueMaterials = new Set();
        let visibleMeshes = 0;
        let castShadowMeshes = 0;
        let receiveShadowMeshes = 0;
        let transparentMeshes = 0;
        let opaqueMeshes = 0;

        scene.traverse((obj: any) => {
          if (obj.isMesh) {
            meshCount += 1;
            if (obj.visible) visibleMeshes += 1;
            if (obj.castShadow) castShadowMeshes += 1;
            if (obj.receiveShadow) receiveShadowMeshes += 1;
            if (obj.material) {
              const isTrans = Array.isArray(obj.material)
                ? obj.material.some((m: any) => m.transparent)
                : Boolean(obj.material.transparent);
              if (isTrans) transparentMeshes += 1;
              else opaqueMeshes += 1;
            }
            if (obj.geometry) uniqueGeometries.add(obj.geometry.id);
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m: any) => uniqueMaterials.add(m.id));
              } else {
                uniqueMaterials.add(obj.material.id);
              }
            }
          }
        });

        const memory = (window.performance as any)?.memory;

        return {
          fps: fpsRef.current,
          drawCalls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          points: gl.info.render.points,
          lines: gl.info.render.lines,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          sceneMeshes: meshCount,
          visibleMeshes,
          castShadowMeshes,
          receiveShadowMeshes,
          transparentMeshes,
          opaqueMeshes,
          uniqueGeometriesCount: uniqueGeometries.size,
          uniqueMaterialsCount: uniqueMaterials.size,
          jsHeapUsedMB: memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
          jsHeapTotalMB: memory ? Math.round((memory.totalJSHeapSize / 1048576) * 10) / 10 : null,
          reactRenderCount: reactRenderCount.current,
        };
      },
    };
  }, [gl, scene, camera]);

  return null;
}

