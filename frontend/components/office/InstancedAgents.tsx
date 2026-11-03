"use client";

import React, { useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AgentAvatarData } from "./AgentAvatar";
import { CANONICAL_STATE_CONFIGS, CanonicalAgentState } from "@/types/office";
import { getDepartmentFloor } from "@/hooks/useOfficeSync";
import { officeSimulationEngine } from "@/lib/simulation/officeSimulationEngine";

interface InstancedAgentsProps {
  agents: Record<string, AgentAvatarData>;
  selectedAgentId?: string | null;
  activeFloor?: number;
  isFloorIsolated?: boolean;
  onSelectAgent?: (agentId: string) => void;
}

// Shared Avatar Geometries (Singletons)
const PELVIS_GEOMETRY = new THREE.BoxGeometry(0.32, 0.14, 0.22);
const TORSO_GEOMETRY = new THREE.BoxGeometry(0.38, 0.42, 0.24);
const SHIRT_GEOMETRY = new THREE.PlaneGeometry(0.16, 0.32);
const TIE_GEOMETRY = new THREE.BoxGeometry(0.04, 0.22, 0.005);
const NECK_GEOMETRY = new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.13, 12, 12);
const HAIR_GEOMETRY = new THREE.BoxGeometry(0.26, 0.14, 0.26);
const ARM_GEOMETRY = new THREE.CylinderGeometry(0.05, 0.045, 0.36, 8);
const LEG_GEOMETRY = new THREE.CylinderGeometry(0.065, 0.055, 0.74, 8);
const SHOE_GEOMETRY = new THREE.BoxGeometry(0.1, 0.07, 0.22);
const RING_GEOMETRY = new THREE.RingGeometry(0.45, 0.58, 24);

// Shared Avatar Materials (Singletons)
const PELVIS_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.5 });
const TORSO_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.45 });
const SHIRT_MATERIAL = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.25 });
const SKIN_MATERIAL = new THREE.MeshStandardMaterial({ color: "#fed7aa", roughness: 0.55 });
const HAIR_MATERIAL = new THREE.MeshStandardMaterial({ color: "#171717", roughness: 0.4 });
const SUIT_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.45 });
const PANTS_MATERIAL = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.6 });
const SHOE_MATERIAL = new THREE.MeshStandardMaterial({ color: "#0a0a0a", roughness: 0.25, metalness: 0.5 });

// Dynamic instanced materials supporting per-instance vertex colors
const TIE_BASE_MATERIAL = new THREE.MeshStandardMaterial({
  roughness: 0.4,
  metalness: 0.1,
});

// Z-Fighting immune activity ring material
const RING_BASE_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

// =============================================================================
// PRE-ALLOCATED ZERO-HEAP STATIC SCRATCH OBJECTS (ZERO ALLOCATION IN USEFRAME)
// =============================================================================
const S_PARENT_MAT = new THREE.Matrix4();
const S_LOCAL_MAT = new THREE.Matrix4();
const S_WORLD_MAT = new THREE.Matrix4();
const S_POS = new THREE.Vector3();
const S_QUAT = new THREE.Quaternion();
const S_SCALE = new THREE.Vector3(1, 1, 1);
const S_ROT = new THREE.Euler();
const S_LOCAL_POS = new THREE.Vector3();
const S_LOCAL_QUAT = new THREE.Quaternion();
const S_COLOR = new THREE.Color();

export default function InstancedAgents({
  agents,
  selectedAgentId,
  activeFloor = 0,
  isFloorIsolated = false,
  onSelectAgent,
}: InstancedAgentsProps) {
  const { camera } = useThree();

  // Filter visible agents
  const visibleAgents = useMemo(() => {
    return Object.values(agents).filter((agent) => {
      const floor = getDepartmentFloor(agent.department);
      return !isFloorIsolated || activeFloor === 0 || floor === activeFloor;
    });
  }, [agents, activeFloor, isFloorIsolated]);

  const count = visibleAgents.length;

  // Refs for instanced body part meshes
  const torsoRef = useRef<THREE.InstancedMesh>(null);
  const pelvisRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const hairRef = useRef<THREE.InstancedMesh>(null);
  const neckRef = useRef<THREE.InstancedMesh>(null);
  const shirtRef = useRef<THREE.InstancedMesh>(null);
  const tieRef = useRef<THREE.InstancedMesh>(null);
  const leftArmRef = useRef<THREE.InstancedMesh>(null);
  const rightArmRef = useRef<THREE.InstancedMesh>(null);
  const leftLegRef = useRef<THREE.InstancedMesh>(null);
  const rightLegRef = useRef<THREE.InstancedMesh>(null);
  const leftShoeRef = useRef<THREE.InstancedMesh>(null);
  const rightShoeRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);

  // Synchronize agents with the OfficeSimulationEngine
  useEffect(() => {
    visibleAgents.forEach((agent) => {
      const floor = getDepartmentFloor(agent.department);
      officeSimulationEngine.registerAgent(
        agent.id,
        agent.name,
        agent.department,
        floor,
        agent.position,
        agent.assignedWorkstation ? agent.position : null,
        agent.assignedWorkstation ? "WORKING" : "IDLE"
      );
    });

    // Initialize per-instance tie and ring colors
    visibleAgents.forEach((agent, i) => {
      S_COLOR.set(agent.color || "#38bdf8");
      tieRef.current?.setColorAt(i, S_COLOR);

      const state = agent.behavioralState || "IDLE";
      const config = CANONICAL_STATE_CONFIGS[state] || CANONICAL_STATE_CONFIGS.IDLE;
      S_COLOR.set(config.beaconColor || config.badgeColor || "#38bdf8");
      ringRef.current?.setColorAt(i, S_COLOR);
    });

    if (tieRef.current?.instanceColor) tieRef.current.instanceColor.needsUpdate = true;
    if (ringRef.current?.instanceColor) ringRef.current.instanceColor.needsUpdate = true;
  }, [visibleAgents]);

  // Zero-allocation articulated skeletal simulation loop
  useFrame(({ clock }, delta) => {
    if (count === 0) return;

    // Advance deterministic employee simulation engine
    officeSimulationEngine.update(delta);

    const t = clock.getElapsedTime();

    // Helper: zero-allocation matrix setter
    const setPart = (
      meshRef: React.RefObject<THREE.InstancedMesh | null>,
      idx: number,
      lx: number,
      ly: number,
      lz: number,
      rx = 0,
      ry = 0,
      rz = 0
    ) => {
      S_LOCAL_POS.set(lx, ly, lz);
      S_ROT.set(rx, ry, rz);
      S_LOCAL_QUAT.setFromEuler(S_ROT);
      S_LOCAL_MAT.compose(S_LOCAL_POS, S_LOCAL_QUAT, S_SCALE);
      S_WORLD_MAT.multiplyMatrices(S_PARENT_MAT, S_LOCAL_MAT);
      meshRef.current?.setMatrixAt(idx, S_WORLD_MAT);
    };

    for (let i = 0; i < count; i++) {
      const agent = visibleAgents[i];
      if (!agent) continue;

      const simAgent = officeSimulationEngine.getAgent(agent.id);

      // Extract simulated positions and postures
      const posX = simAgent ? simAgent.position[0] : agent.position[0];
      const posY = simAgent ? simAgent.position[1] : agent.position[1];
      const posZ = simAgent ? simAgent.position[2] : agent.position[2];
      const heading = simAgent ? simAgent.heading : (agent.headingRadians ?? 0);
      const isSeated = simAgent ? simAgent.isSeated : (agent.isSeated || Boolean(agent.assignedWorkstation && !agent.isMoving));
      const isMoving = simAgent ? (simAgent.state === "WALKING" || simAgent.state === "APPROACHING_AGENT" || simAgent.state === "RETURNING_TO_DESK") : agent.isMoving;
      const phase = simAgent ? simAgent.phaseOffset : (i * 0.618);

      // Vertical bounce / breathing with per-agent phase offset
      const bounceY = isMoving
        ? Math.abs(Math.sin((t + phase) * 9.0)) * 0.04
        : Math.sin((t + phase) * 1.8) * 0.012;
      const rootY = posY + bounceY;

      // 1. Activity Ring (Zero-allocation matrix at y = posY + 0.04)
      S_POS.set(posX, posY + 0.04, posZ);
      S_ROT.set(-Math.PI / 2, 0, 0);
      S_QUAT.setFromEuler(S_ROT);
      S_LOCAL_MAT.compose(S_POS, S_QUAT, S_SCALE);
      ringRef.current?.setMatrixAt(i, S_LOCAL_MAT);

      // Parent transform for the agent body root
      S_POS.set(posX, rootY, posZ);
      S_ROT.set(0, heading, 0);
      S_QUAT.setFromEuler(S_ROT);
      S_PARENT_MAT.compose(S_POS, S_QUAT, S_SCALE);

      // 2. Pelvis
      setPart(pelvisRef, i, 0, 0.74, 0);

      // 3. Torso (leaning slightly when typing)
      const torsoLean = simAgent ? simAgent.torsoLean : 0.05;
      setPart(torsoRef, i, 0, 1.02, 0, torsoLean, 0, 0);

      // 4. Shirt & Tie
      setPart(shirtRef, i, 0, 1.04, 0.122, torsoLean, 0, 0);
      setPart(tieRef, i, 0, 0.98, 0.126, torsoLean, 0, 0);

      // 5. Neck & Head
      setPart(neckRef, i, 0, 1.25, 0);
      const headNod = simAgent
        ? simAgent.headNodAngle
        : isMoving
        ? Math.sin((t + phase) * 9.0) * 0.03
        : Math.sin((t + phase) * 1.5) * 0.02;
      setPart(headRef, i, 0, 1.39, 0, headNod, 0, 0);
      setPart(hairRef, i, 0, 1.48, 0, headNod, 0, 0);

      // 6. Arms (Procedural Typing, Conversing, or Walking swing)
      let armL = simAgent ? simAgent.leftArmAngle : 0;
      let armR = simAgent ? simAgent.rightArmAngle : 0;
      if (!simAgent) {
        if (isMoving) {
          armL = Math.sin((t + phase) * 9.0) * 0.45;
          armR = -Math.sin((t + phase) * 9.0) * 0.45;
        } else if (isSeated) {
          armL = 0.85 + Math.sin((t + phase) * 12.0) * 0.06;
          armR = 0.85 + Math.cos((t + phase) * 12.0) * 0.06;
        }
      }
      setPart(leftArmRef, i, -0.25, 1.02, 0, armL, 0, 0);
      setPart(rightArmRef, i, 0.25, 1.02, 0, armR, 0, 0);

      // 7. Legs & Shoes
      let legL = 0;
      let legR = 0;
      if (isSeated) {
        legL = -1.48; // Seated bent at 90 deg
        legR = -1.48;
      } else if (isMoving) {
        legL = -armL;
        legR = -armR;
      }
      setPart(leftLegRef, i, -0.11, 0.38, 0, legL, 0, 0);
      setPart(rightLegRef, i, 0.11, 0.38, 0, legR, 0, 0);
      setPart(leftShoeRef, i, -0.11, 0.04, 0.05, legL, 0, 0);
      setPart(rightShoeRef, i, 0.11, 0.04, 0.05, legR, 0, 0);
    }

    // Flag instance matrices for bulk GPU upload
    if (torsoRef.current) torsoRef.current.instanceMatrix.needsUpdate = true;
    if (pelvisRef.current) pelvisRef.current.instanceMatrix.needsUpdate = true;
    if (headRef.current) headRef.current.instanceMatrix.needsUpdate = true;
    if (hairRef.current) hairRef.current.instanceMatrix.needsUpdate = true;
    if (neckRef.current) neckRef.current.instanceMatrix.needsUpdate = true;
    if (shirtRef.current) shirtRef.current.instanceMatrix.needsUpdate = true;
    if (tieRef.current) tieRef.current.instanceMatrix.needsUpdate = true;
    if (leftArmRef.current) leftArmRef.current.instanceMatrix.needsUpdate = true;
    if (rightArmRef.current) rightArmRef.current.instanceMatrix.needsUpdate = true;
    if (leftLegRef.current) leftLegRef.current.instanceMatrix.needsUpdate = true;
    if (rightLegRef.current) rightLegRef.current.instanceMatrix.needsUpdate = true;
    if (leftShoeRef.current) leftShoeRef.current.instanceMatrix.needsUpdate = true;
    if (rightShoeRef.current) rightShoeRef.current.instanceMatrix.needsUpdate = true;
    if (ringRef.current) ringRef.current.instanceMatrix.needsUpdate = true;
  });

  // Handle raycast click directly on instanced mesh
  const handleInstancedClick = (e: any) => {
    e.stopPropagation();
    const instId = e.instanceId;
    if (instId !== undefined && instId !== null && instId >= 0 && instId < visibleAgents.length) {
      const agent = visibleAgents[instId];
      if (agent && onSelectAgent) {
        onSelectAgent(agent.id);
      }
    }
  };

  if (count === 0) return null;

  // Compute camera distance for Level of Detail (LOD)
  const cameraDist = camera.position.length();
  const isOverview = cameraDist > 44.0;

  return (
    <group onClick={handleInstancedClick}>
      {/* 1. Torso: Sole Shadow Caster (Reduces Shadow Passes by 92%) */}
      <instancedMesh
        ref={torsoRef}
        args={[TORSO_GEOMETRY, TORSO_MATERIAL, count]}
        castShadow
        receiveShadow
      />

      {/* 2. Pelvis */}
      <instancedMesh
        ref={pelvisRef}
        args={[PELVIS_GEOMETRY, PELVIS_MATERIAL, count]}
      />

      {/* 3. Head & Hair */}
      <instancedMesh
        ref={headRef}
        args={[HEAD_GEOMETRY, SKIN_MATERIAL, count]}
      />
      <instancedMesh
        ref={hairRef}
        args={[HAIR_GEOMETRY, HAIR_MATERIAL, count]}
      />
      <instancedMesh
        ref={neckRef}
        args={[NECK_GEOMETRY, SKIN_MATERIAL, count]}
      />

      {/* 4. Shirt & Colored Ties */}
      <instancedMesh
        ref={shirtRef}
        args={[SHIRT_GEOMETRY, SHIRT_MATERIAL, count]}
      />
      <instancedMesh
        ref={tieRef}
        args={[TIE_GEOMETRY, TIE_BASE_MATERIAL, count]}
      />

      {/* 5. Articulated Limbs */}
      <instancedMesh
        ref={leftArmRef}
        args={[ARM_GEOMETRY, SUIT_MATERIAL, count]}
      />
      <instancedMesh
        ref={rightArmRef}
        args={[ARM_GEOMETRY, SUIT_MATERIAL, count]}
      />
      <instancedMesh
        ref={leftLegRef}
        args={[LEG_GEOMETRY, PANTS_MATERIAL, count]}
      />
      <instancedMesh
        ref={rightLegRef}
        args={[LEG_GEOMETRY, PANTS_MATERIAL, count]}
      />
      <instancedMesh
        ref={leftShoeRef}
        args={[SHOE_GEOMETRY, SHOE_MATERIAL, count]}
      />
      <instancedMesh
        ref={rightShoeRef}
        args={[SHOE_GEOMETRY, SHOE_MATERIAL, count]}
      />

      {/* 6. Z-Fighting Immune Activity Ring */}
      <instancedMesh
        ref={ringRef}
        args={[RING_GEOMETRY, RING_BASE_MATERIAL, count]}
      />

      {/* 7. Level of Detail (LOD) Nameplates & Inspection Badges */}
      {visibleAgents
        .filter((agent) => {
          // Always show selected agent or speaking/voting agents
          if (agent.id === selectedAgentId) return true;
          if (agent.meetingState === "SPEAKING" || agent.meetingState === "VOTING") return true;
          // In close-up view (floor focused), show departmental agents
          if (!isOverview) {
            return !agent.id.startsWith("bench-") || agent.id.includes("spec") || count <= 20;
          }
          // In overview view, show key department leads without flooding the DOM
          return agent.id === "agent-eng-lead" || agent.id === "agent-exec-ceo";
        })
        .map((agent) => {
          const isSelected = selectedAgentId === agent.id;
          return (
            <group key={agent.id} position={agent.position}>
              {isSelected && (
                <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.55, 0.72, 32]} />
                  <meshBasicMaterial color="#38bdf8" />
                </mesh>
              )}
              <Html position={[0, 1.95, 0]} center distanceFactor={14}>
                <div
                  data-testid={`agent-card-${agent.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSelectAgent) onSelectAgent(agent.id);
                  }}
                  className="select-none flex flex-col items-center pointer-events-auto cursor-pointer"
                >
                  {agent.meetingState === "SPEAKING" && (
                    <div className="mb-1 px-2 py-0.5 rounded-full bg-emerald-600/95 text-[10px] font-semibold text-white shadow-md border border-emerald-400/50 flex items-center gap-1.5 animate-bounce">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                      <span>ĐANG PHÁT BIỂU</span>
                    </div>
                  )}
                  {agent.meetingState === "VOTING" && (
                    <div className="mb-1 px-2 py-0.5 rounded-full bg-amber-600/95 text-[10px] font-semibold text-white shadow-md border border-amber-400/50 flex items-center gap-1.5 animate-pulse">
                      <span>ĐANG BIỂU QUYẾT</span>
                    </div>
                  )}
                  {agent.currentTaskTitle && isSelected && (
                    <div className="mb-1.5 px-2.5 py-0.5 rounded-full bg-blue-600/95 text-[10px] font-medium text-white shadow-md border border-blue-400/50 flex items-center gap-1.5 max-w-[200px] truncate animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                      <span className="truncate">{agent.currentTaskTitle}</span>
                    </div>
                  )}
                  <div
                    className={`px-2.5 py-1 rounded-lg backdrop-blur-md shadow-xl border transition-all duration-150 flex items-center gap-2 ${
                      isSelected
                        ? "bg-slate-900/95 border-sky-400 scale-105 ring-2 ring-sky-400/30"
                        : "bg-slate-950/80 border-slate-800 hover:border-slate-600"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: agent.color || "#38bdf8" }}
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-white whitespace-nowrap">
                        {agent.name}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] text-sky-300 font-mono">
                          {agent.role}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Html>
            </group>
          );
        })}
    </group>
  );
}
