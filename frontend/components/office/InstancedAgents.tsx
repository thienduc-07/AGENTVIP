"use client";

import React, { useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AgentAvatarData } from "./AgentAvatar";
import { CANONICAL_STATE_CONFIGS, CanonicalAgentState } from "@/types/office";
import { getDepartmentFloor } from "@/hooks/useOfficeSync";

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
const RING_BASE_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});

export default function InstancedAgents({
  agents,
  selectedAgentId,
  activeFloor = 0,
  isFloorIsolated = false,
  onSelectAgent,
}: InstancedAgentsProps) {
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

  // Per-agent simulation tracking
  const agentPositions = useRef<Array<THREE.Vector3>>([]);
  const agentHeadings = useRef<Float32Array>(new Float32Array(0));

  // Initialize and synchronize per-agent state arrays
  useEffect(() => {
    agentPositions.current = visibleAgents.map((a) => new THREE.Vector3(...a.position));
    agentHeadings.current = new Float32Array(visibleAgents.map((a) => a.headingRadians ?? 0));

    // Initialize per-instance tie and ring colors
    const tieColor = new THREE.Color();
    const ringColor = new THREE.Color();

    visibleAgents.forEach((agent, i) => {
      tieColor.set(agent.color || "#38bdf8");
      tieRef.current?.setColorAt(i, tieColor);

      const state = agent.behavioralState || "IDLE";
      const config = CANONICAL_STATE_CONFIGS[state] || CANONICAL_STATE_CONFIGS.IDLE;
      ringColor.set(config.beaconColor || config.badgeColor || "#38bdf8");
      ringRef.current?.setColorAt(i, ringColor);
    });

    if (tieRef.current?.instanceColor) tieRef.current.instanceColor.needsUpdate = true;
    if (ringRef.current?.instanceColor) ringRef.current.instanceColor.needsUpdate = true;
  }, [visibleAgents]);

  // Articulated skeletal animation loop across all 100 agents in one pass
  useFrame(({ clock }, delta) => {
    if (count === 0) return;

    const t = clock.getElapsedTime();
    const dummy = new THREE.Object3D();
    const parentDummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const agent = visibleAgents[i];
      if (!agent) continue;

      const pos = agentPositions.current[i];
      if (!pos) continue;

      const isMoving = agent.isMoving || Boolean(agent.targetPosition);
      const isSeated = agent.isSeated || Boolean(agent.assignedWorkstation && !isMoving);

      // Smooth position lerp towards destination target
      const targetPos = agent.targetPosition ? agent.targetPosition : agent.position;
      pos.x = THREE.MathUtils.lerp(pos.x, targetPos[0], Math.min(1, delta * (isMoving ? 8 : 12)));
      pos.y = THREE.MathUtils.lerp(pos.y, targetPos[1], Math.min(1, delta * (isMoving ? 8 : 12)));
      pos.z = THREE.MathUtils.lerp(pos.z, targetPos[2], Math.min(1, delta * (isMoving ? 8 : 12)));

      // Smooth heading calculation
      if (isMoving && agent.targetPosition) {
        const diffX = agent.targetPosition[0] - pos.x;
        const diffZ = agent.targetPosition[2] - pos.z;
        if (Math.abs(diffX) > 0.04 || Math.abs(diffZ) > 0.04) {
          const targetHeading = Math.atan2(diffX, diffZ);
          agentHeadings.current[i] = THREE.MathUtils.lerp(agentHeadings.current[i], targetHeading, Math.min(1, delta * 10));
        }
      } else if (agent.headingRadians !== undefined) {
        agentHeadings.current[i] = THREE.MathUtils.lerp(agentHeadings.current[i], agent.headingRadians, Math.min(1, delta * 8));
      }

      const heading = agentHeadings.current[i];
      const phase = i * 0.618;

      // Vertical bounce / breathing with per-agent phase offset to eliminate lockstep
      const bounceY = isMoving
        ? Math.abs(Math.sin((t + phase) * 9.0)) * 0.05
        : Math.sin((t + phase) * 1.8) * 0.015;
      const rootY = pos.y + bounceY;

      // Parent transform for the agent root
      parentDummy.position.set(pos.x, rootY, pos.z);
      parentDummy.rotation.set(0, heading, 0);

      // 1. Activity Ring [on floor slab, unbounced]
      dummy.position.set(pos.x, pos.y + 0.01, pos.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ringRef.current?.setMatrixAt(i, dummy.matrix);

      // Helper function to compose local part onto world matrix
      const setPart = (
        meshRef: React.RefObject<THREE.InstancedMesh | null>,
        localPos: [number, number, number],
        localRot: [number, number, number] = [0, 0, 0]
      ) => {
        dummy.position.set(...localPos);
        dummy.rotation.set(...localRot);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();

        // Multiply parent matrix by child local matrix
        const worldMatrix = parentDummy.matrix.clone().multiply(dummy.matrix);
        meshRef.current?.setMatrixAt(i, worldMatrix);
      };

      parentDummy.updateMatrix();

      // 2. Pelvis [0, 0.74, 0]
      setPart(pelvisRef, [0, 0.74, 0]);

      // 3. Torso [0, 1.02, 0]
      setPart(torsoRef, [0, 1.02, 0]);

      // 4. Shirt [0, 1.04, 0.122]
      setPart(shirtRef, [0, 1.04, 0.122]);

      // 5. Tie [0, 0.98, 0.126]
      setPart(tieRef, [0, 0.98, 0.126]);

      // 6. Neck [0, 1.25, 0]
      setPart(neckRef, [0, 1.25, 0]);

      // 7. Head [0, 1.39, 0]
      const headNod = isMoving
        ? Math.sin((t + phase) * 9.0) * 0.03
        : Math.sin((t + phase) * 1.5) * 0.02;
      setPart(headRef, [0, 1.39, 0], [headNod, 0, 0]);

      // 8. Hair [0, 1.48, 0]
      setPart(hairRef, [0, 1.48, 0], [headNod, 0, 0]);

      // 9. Arms (Swinging during walk, or bent typing when seated)
      let armSwingL = 0;
      let armSwingR = 0;
      if (isMoving) {
        armSwingL = Math.sin((t + phase) * 9.0) * 0.45;
        armSwingR = -Math.sin((t + phase) * 9.0) * 0.45;
      } else if (isSeated) {
        armSwingL = 0.85 + Math.sin((t + phase) * 12.0) * 0.06; // Typing animation
        armSwingR = 0.85 + Math.cos((t + phase) * 12.0) * 0.06;
      }
      setPart(leftArmRef, [-0.25, 1.02, 0], [armSwingL, 0, 0]);
      setPart(rightArmRef, [0.25, 1.02, 0], [armSwingR, 0, 0]);

      // 10. Legs & Shoes
      let legAngleL = 0;
      let legAngleR = 0;
      if (isSeated) {
        legAngleL = -1.48; // Seated bent at 90 deg
        legAngleR = -1.48;
      } else if (isMoving) {
        legAngleL = -armSwingL;
        legAngleR = -armSwingR;
      }
      setPart(leftLegRef, [-0.11, 0.38, 0], [legAngleL, 0, 0]);
      setPart(rightLegRef, [0.11, 0.38, 0], [legAngleR, 0, 0]);

      // Shoes
      setPart(leftShoeRef, [-0.11, 0.04, 0.05], [legAngleL, 0, 0]);
      setPart(rightShoeRef, [0.11, 0.04, 0.05], [legAngleR, 0, 0]);
    }

    // Flag instance matrices for GPU upload
    [
      torsoRef,
      pelvisRef,
      headRef,
      hairRef,
      neckRef,
      shirtRef,
      tieRef,
      leftArmRef,
      rightArmRef,
      leftLegRef,
      rightLegRef,
      leftShoeRef,
      rightShoeRef,
      ringRef,
    ].forEach((ref) => {
      if (ref.current) {
        ref.current.instanceMatrix.needsUpdate = true;
      }
    });
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

  const selectedAgent = selectedAgentId ? agents[selectedAgentId] : null;

  if (count === 0) return null;

  return (
    <group onClick={handleInstancedClick}>
      {/* 1. Torso (Instanced Shadow Caster) */}
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

      {/* 6. Floor Activity Ring */}
      <instancedMesh
        ref={ringRef}
        args={[RING_GEOMETRY, RING_BASE_MATERIAL, count]}
      />

      {/* 7. Floating Name & Role Badges for Authentic Agency Employees and Selected Agent */}
      {visibleAgents
        .filter((a) => !a.id.startsWith("bench-") || a.id === selectedAgentId || a.id.includes("spec") || visibleAgents.length <= 25)
        .map((agent) => {
          const isSelected = selectedAgentId === agent.id;
          return (
            <group key={agent.id} position={agent.position}>
              {isSelected && (
                <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
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
