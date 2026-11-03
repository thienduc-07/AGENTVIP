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

// =============================================================================
// CHIBI CHARACTER GEOMETRIES (PROPORTION ~2.5 HEADS - CUTE EXPRESSIVE CHIBI)
// =============================================================================
const HEAD_GEO = new THREE.SphereGeometry(0.22, 20, 16);
const HAIR_GEO = new THREE.SphereGeometry(0.24, 20, 14);
const EYE_GEO = new THREE.SphereGeometry(0.038, 12, 10);
const EYE_PUPIL_GEO = new THREE.SphereGeometry(0.016, 8, 8);
const TORSO_GEO = new THREE.CylinderGeometry(0.12, 0.16, 0.28, 16);
const COLLAR_GEO = new THREE.TorusGeometry(0.09, 0.02, 8, 20);
const ARM_GEO = new THREE.CylinderGeometry(0.042, 0.038, 0.20, 10);
const HAND_GEO = new THREE.SphereGeometry(0.045, 12, 10);
const THIGH_GEO = new THREE.CylinderGeometry(0.05, 0.045, 0.16, 10);
const SHIN_GEO = new THREE.CylinderGeometry(0.045, 0.042, 0.16, 10);
const SHOE_GEO = new THREE.BoxGeometry(0.10, 0.065, 0.15);
const RING_GEO = new THREE.RingGeometry(0.40, 0.52, 24);

// Accessories
const ACCESSORY_MUG_GEO = new THREE.CylinderGeometry(0.035, 0.03, 0.07, 10);
const ACCESSORY_BOOK_GEO = new THREE.BoxGeometry(0.18, 0.02, 0.14);

// Materials
const SKIN_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#fed7aa",
  roughness: 0.5,
  metalness: 0.05,
});

const HAIR_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#292524",
  roughness: 0.35,
  metalness: 0.1,
});

const EYE_MATERIAL = new THREE.MeshBasicMaterial({ color: "#1e1612" });
const WHITE_MATERIAL = new THREE.MeshBasicMaterial({ color: "#ffffff" });

const TOP_BASE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#3b82f6",
  roughness: 0.55,
  metalness: 0.1,
});

const PANTS_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#1e293b",
  roughness: 0.6,
});

const SHOE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#0f172a",
  roughness: 0.3,
});

const MUG_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#f8fafc",
  roughness: 0.2,
});

const RING_BASE_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

// Pre-allocated static scratch objects
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

  const visibleAgents = useMemo(() => {
    return Object.values(agents).filter((agent) => {
      const floor = getDepartmentFloor(agent.department);
      return !isFloorIsolated || activeFloor === 0 || floor === activeFloor;
    });
  }, [agents, activeFloor, isFloorIsolated]);

  const count = visibleAgents.length;

  // Instanced Meshes Refs
  const headRef = useRef<THREE.InstancedMesh>(null);
  const hairRef = useRef<THREE.InstancedMesh>(null);
  const eyeLRef = useRef<THREE.InstancedMesh>(null);
  const eyeRRef = useRef<THREE.InstancedMesh>(null);
  const eyePupilLRef = useRef<THREE.InstancedMesh>(null);
  const eyePupilRRef = useRef<THREE.InstancedMesh>(null);
  const torsoRef = useRef<THREE.InstancedMesh>(null);
  const collarRef = useRef<THREE.InstancedMesh>(null);
  const armLRef = useRef<THREE.InstancedMesh>(null);
  const armRRef = useRef<THREE.InstancedMesh>(null);
  const handLRef = useRef<THREE.InstancedMesh>(null);
  const handRRef = useRef<THREE.InstancedMesh>(null);
  const thighLRef = useRef<THREE.InstancedMesh>(null);
  const thighRRef = useRef<THREE.InstancedMesh>(null);
  const shinLRef = useRef<THREE.InstancedMesh>(null);
  const shinRRef = useRef<THREE.InstancedMesh>(null);
  const shoeLRef = useRef<THREE.InstancedMesh>(null);
  const shoeRRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const mugRef = useRef<THREE.InstancedMesh>(null);

  // Sync with simulation engine
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
  }, [visibleAgents]);

  // Set colors on mount/change
  useEffect(() => {
    visibleAgents.forEach((agent, i) => {
      const state = agent.behavioralState || "IDLE";
      const config = CANONICAL_STATE_CONFIGS[state] || CANONICAL_STATE_CONFIGS.IDLE;
      const simAgent = officeSimulationEngine.getAgent(agent.id);

      // Top / Shirt color
      const shirtColor = simAgent?.chibiStyle.shirtColor || agent.color || "#3b82f6";
      S_COLOR.set(shirtColor);
      torsoRef.current?.setColorAt(i, S_COLOR);
      armLRef.current?.setColorAt(i, S_COLOR);
      armRRef.current?.setColorAt(i, S_COLOR);

      // Hair color
      const hairColor = simAgent?.chibiStyle.hairColor || "#292524";
      S_COLOR.set(hairColor);
      hairRef.current?.setColorAt(i, S_COLOR);

      // Skin color
      const skinColor = simAgent?.chibiStyle.skinColor || "#fed7aa";
      S_COLOR.set(skinColor);
      headRef.current?.setColorAt(i, S_COLOR);
      handLRef.current?.setColorAt(i, S_COLOR);
      handRRef.current?.setColorAt(i, S_COLOR);

      // Pants color
      const pantsColor = simAgent?.chibiStyle.pantsColor || "#1e293b";
      S_COLOR.set(pantsColor);
      thighLRef.current?.setColorAt(i, S_COLOR);
      thighRRef.current?.setColorAt(i, S_COLOR);
      shinLRef.current?.setColorAt(i, S_COLOR);
      shinRRef.current?.setColorAt(i, S_COLOR);

      // Ring status color
      S_COLOR.set(config.beaconColor);
      ringRef.current?.setColorAt(i, S_COLOR);
    });

    if (torsoRef.current?.instanceColor) torsoRef.current.instanceColor.needsUpdate = true;
    if (armLRef.current?.instanceColor) armLRef.current.instanceColor.needsUpdate = true;
    if (armRRef.current?.instanceColor) armRRef.current.instanceColor.needsUpdate = true;
    if (hairRef.current?.instanceColor) hairRef.current.instanceColor.needsUpdate = true;
    if (headRef.current?.instanceColor) headRef.current.instanceColor.needsUpdate = true;
    if (handLRef.current?.instanceColor) handLRef.current.instanceColor.needsUpdate = true;
    if (handRRef.current?.instanceColor) handRRef.current.instanceColor.needsUpdate = true;
    if (thighLRef.current?.instanceColor) thighLRef.current.instanceColor.needsUpdate = true;
    if (thighRRef.current?.instanceColor) thighRRef.current.instanceColor.needsUpdate = true;
    if (shinLRef.current?.instanceColor) shinLRef.current.instanceColor.needsUpdate = true;
    if (shinRRef.current?.instanceColor) shinRRef.current.instanceColor.needsUpdate = true;
    if (ringRef.current?.instanceColor) ringRef.current.instanceColor.needsUpdate = true;
  }, [visibleAgents]);

  const setPart = (
    ref: React.RefObject<THREE.InstancedMesh | null>,
    index: number,
    localX: number,
    localY: number,
    localZ: number,
    rotX: number = 0,
    rotY: number = 0,
    rotZ: number = 0,
    scaleX: number = 1,
    scaleY: number = 1,
    scaleZ: number = 1
  ) => {
    if (!ref.current) return;
    S_LOCAL_POS.set(localX, localY, localZ);
    S_ROT.set(rotX, rotY, rotZ);
    S_LOCAL_QUAT.setFromEuler(S_ROT);
    S_SCALE.set(scaleX, scaleY, scaleZ);
    S_LOCAL_MAT.compose(S_LOCAL_POS, S_LOCAL_QUAT, S_SCALE);
    S_WORLD_MAT.multiplyMatrices(S_PARENT_MAT, S_LOCAL_MAT);
    ref.current.setMatrixAt(index, S_WORLD_MAT);
  };

  useFrame((state, delta) => {
    officeSimulationEngine.update(state.clock.elapsedTime, delta);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < visibleAgents.length; i++) {
      const agent = visibleAgents[i];
      const simAgent = officeSimulationEngine.getAgent(agent.id);

      const isSeated = simAgent ? simAgent.isSeated : (agent.isSeated || Boolean(agent.assignedWorkstation));
      const isMoving = simAgent
        ? simAgent.state === "WALKING" || simAgent.state === "RUNNING" || simAgent.state === "APPROACHING_AGENT"
        : agent.isMoving;

      // PRECISE WORKSTATION CHAIR SITTING:
      // When seated at a workstation, anchor pelvis on chair cushion (Z + 0.55m from desk)
      const posX = simAgent ? simAgent.position[0] : agent.position[0];
      const posY = simAgent ? simAgent.position[1] : agent.position[1];
      const posZ = isSeated && !isMoving && agent.assignedWorkstation
        ? agent.position[2] + 0.55
        : simAgent ? simAgent.position[2] : agent.position[2];

      const heading = isSeated && !isMoving ? Math.PI : (simAgent ? simAgent.heading : (agent.headingRadians ?? Math.PI));
      const phase = simAgent ? simAgent.phaseOffset : (i * 0.618);

      // Walking bounce vs breathing
      const bounceY = isMoving
        ? Math.abs(Math.sin((t + phase) * 9.0)) * 0.04
        : Math.sin((t + phase) * 1.8) * 0.012;

      // Seated root pelvis sits on chair cushion (y = 0.44 above floor)
      const rootY = isSeated && !isMoving ? (posY + 0.44) : (posY + bounceY);

      // Activity Ring
      S_POS.set(posX, posY + 0.04, posZ);
      S_ROT.set(-Math.PI / 2, 0, 0);
      S_QUAT.setFromEuler(S_ROT);
      S_LOCAL_MAT.compose(S_POS, S_QUAT, S_SCALE);
      ringRef.current?.setMatrixAt(i, S_LOCAL_MAT);

      // Root Parent Matrix
      S_POS.set(posX, rootY, posZ);
      S_ROT.set(0, heading, 0);
      S_QUAT.setFromEuler(S_ROT);
      S_PARENT_MAT.compose(S_POS, S_QUAT, S_SCALE);

      // 1. Torso & Collar
      const torsoLean = simAgent ? simAgent.torsoLean : 0.06;
      setPart(torsoRef, i, 0, 0.22, 0, torsoLean, 0, 0);
      setPart(collarRef, i, 0, 0.36, 0.01, Math.PI / 2 + torsoLean, 0, 0);

      // 2. Chibi Head & Styled Hair
      const headNod = simAgent ? simAgent.headNodAngle : 0.05;
      setPart(headRef, i, 0, 0.54, 0.02, headNod + torsoLean, 0, 0);
      setPart(hairRef, i, 0, 0.58, -0.01, headNod + torsoLean, 0, 0, 1.02, 1.04, 1.02);

      // 3. Expressive Chibi Eyes with Blinking
      const blinkScaleY = simAgent && simAgent.isBlinking ? 0.1 : 1.0;
      setPart(eyeLRef, i, -0.075, 0.54, 0.22, headNod + torsoLean, -0.15, 0, 0.85, blinkScaleY, 0.4);
      setPart(eyeRRef, i, 0.075, 0.54, 0.22, headNod + torsoLean, 0.15, 0, 0.85, blinkScaleY, 0.4);
      setPart(eyePupilLRef, i, -0.06, 0.555, 0.23, headNod + torsoLean, -0.15, 0, 1, blinkScaleY, 0.5);
      setPart(eyePupilRRef, i, 0.09, 0.555, 0.23, headNod + torsoLean, 0.15, 0, 1, blinkScaleY, 0.5);

      // 4. Arms & Hands (Procedural Typing / Coffee / Walking)
      let armL = simAgent ? simAgent.leftArmAngle : 0;
      let armR = simAgent ? simAgent.rightArmAngle : 0;

      if (isSeated && !isMoving) {
        // Typing motions resting near keyboard
        armL = 0.85 + Math.sin(t * 16.0 + phase) * 0.04;
        armR = 0.85 + Math.cos(t * 16.0 + phase) * 0.04;
      } else if (isMoving) {
        armL = Math.sin((t + phase) * 9.0) * 0.45;
        armR = -Math.sin((t + phase) * 9.0) * 0.45;
      }

      setPart(armLRef, i, -0.16, 0.26, 0, armL + torsoLean, 0, 0.15);
      setPart(armRRef, i, 0.16, 0.26, 0, armR + torsoLean, 0, -0.15);
      setPart(handLRef, i, -0.16, 0.26 - Math.cos(armL) * 0.18, Math.sin(armL) * 0.18, armL, 0, 0);
      setPart(handRRef, i, 0.16, 0.26 - Math.cos(armR) * 0.18, Math.sin(armR) * 0.18, armR, 0, 0);

      // 5. Thighs, Shins & Shoes
      let thighL = 0;
      let thighR = 0;
      let shinL = 0;
      let shinR = 0;

      if (isSeated && !isMoving) {
        // Seated on chair: thighs extend forward 90 deg, shins drop vertically under desk
        thighL = -Math.PI / 2 + 0.08;
        thighR = -Math.PI / 2 + 0.08;
        shinL = 0;
        shinR = 0;
        setPart(thighLRef, i, -0.075, 0.08, 0.08, thighL, 0, 0);
        setPart(thighRRef, i, 0.075, 0.08, 0.08, thighR, 0, 0);
        setPart(shinLRef, i, -0.075, -0.02, 0.16, shinL, 0, 0);
        setPart(shinRRef, i, 0.075, -0.02, 0.16, shinR, 0, 0);
        setPart(shoeLRef, i, -0.075, -0.12, 0.20, 0, 0, 0);
        setPart(shoeRRef, i, 0.075, -0.12, 0.20, 0, 0, 0);
      } else if (isMoving) {
        thighL = -armL * 0.8;
        thighR = -armR * 0.8;
        setPart(thighLRef, i, -0.075, 0.08, 0, thighL, 0, 0);
        setPart(thighRRef, i, 0.075, 0.08, 0, thighR, 0, 0);
        setPart(shinLRef, i, -0.075, -0.06, 0, thighL * 0.8, 0, 0);
        setPart(shinRRef, i, 0.075, -0.06, 0, thighR * 0.8, 0, 0);
        setPart(shoeLRef, i, -0.075, -0.18, 0.02, 0, 0, 0);
        setPart(shoeRRef, i, 0.075, -0.18, 0.02, 0, 0, 0);
      } else {
        // Upright standing
        setPart(thighLRef, i, -0.075, 0.08, 0, 0, 0, 0);
        setPart(thighRRef, i, 0.075, 0.08, 0, 0, 0, 0);
        setPart(shinLRef, i, -0.075, -0.06, 0, 0, 0, 0);
        setPart(shinRRef, i, 0.075, -0.06, 0, 0, 0, 0);
        setPart(shoeLRef, i, -0.075, -0.18, 0.02, 0, 0, 0);
        setPart(shoeRRef, i, 0.075, -0.18, 0.02, 0, 0, 0);
      }

      // 6. Coffee Mug (for DRINKING state)
      if (simAgent?.state === "DRINKING") {
        setPart(mugRef, i, 0.16, 0.42, 0.14, 0, 0, 0, 1, 1, 1);
      } else {
        // Hide mug underground
        setPart(mugRef, i, 0, -100, 0, 0, 0, 0, 0.001, 0.001, 0.001);
      }
    }

    // Flag instance matrices for GPU upload
    if (headRef.current) headRef.current.instanceMatrix.needsUpdate = true;
    if (hairRef.current) hairRef.current.instanceMatrix.needsUpdate = true;
    if (eyeLRef.current) eyeLRef.current.instanceMatrix.needsUpdate = true;
    if (eyeRRef.current) eyeRRef.current.instanceMatrix.needsUpdate = true;
    if (eyePupilLRef.current) eyePupilLRef.current.instanceMatrix.needsUpdate = true;
    if (eyePupilRRef.current) eyePupilRRef.current.instanceMatrix.needsUpdate = true;
    if (torsoRef.current) torsoRef.current.instanceMatrix.needsUpdate = true;
    if (collarRef.current) collarRef.current.instanceMatrix.needsUpdate = true;
    if (armLRef.current) armLRef.current.instanceMatrix.needsUpdate = true;
    if (armRRef.current) armRRef.current.instanceMatrix.needsUpdate = true;
    if (handLRef.current) handLRef.current.instanceMatrix.needsUpdate = true;
    if (handRRef.current) handRRef.current.instanceMatrix.needsUpdate = true;
    if (thighLRef.current) thighLRef.current.instanceMatrix.needsUpdate = true;
    if (thighRRef.current) thighRRef.current.instanceMatrix.needsUpdate = true;
    if (shinLRef.current) shinLRef.current.instanceMatrix.needsUpdate = true;
    if (shinRRef.current) shinRRef.current.instanceMatrix.needsUpdate = true;
    if (shoeLRef.current) shoeLRef.current.instanceMatrix.needsUpdate = true;
    if (shoeRRef.current) shoeRRef.current.instanceMatrix.needsUpdate = true;
    if (ringRef.current) ringRef.current.instanceMatrix.needsUpdate = true;
    if (mugRef.current) mugRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* 1. Activity Ring */}
      <instancedMesh
        ref={ringRef}
        args={[RING_GEO, RING_BASE_MATERIAL, count]}
        renderOrder={1}
      />

      {/* 2. Body Parts */}
      <instancedMesh
        ref={torsoRef}
        args={[TORSO_GEO, TOP_BASE_MATERIAL, count]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={collarRef}
        args={[COLLAR_GEO, WHITE_MATERIAL, count]}
      />
      <instancedMesh
        ref={headRef}
        args={[HEAD_GEO, SKIN_MATERIAL, count]}
      />
      <instancedMesh
        ref={hairRef}
        args={[HAIR_GEO, HAIR_MATERIAL, count]}
      />

      {/* Eyes & Pupils */}
      <instancedMesh
        ref={eyeLRef}
        args={[EYE_GEO, EYE_MATERIAL, count]}
      />
      <instancedMesh
        ref={eyeRRef}
        args={[EYE_GEO, EYE_MATERIAL, count]}
      />
      <instancedMesh
        ref={eyePupilLRef}
        args={[EYE_PUPIL_GEO, WHITE_MATERIAL, count]}
      />
      <instancedMesh
        ref={eyePupilRRef}
        args={[EYE_PUPIL_GEO, WHITE_MATERIAL, count]}
      />

      {/* Arms & Hands */}
      <instancedMesh
        ref={armLRef}
        args={[ARM_GEO, TOP_BASE_MATERIAL, count]}
      />
      <instancedMesh
        ref={armRRef}
        args={[ARM_GEO, TOP_BASE_MATERIAL, count]}
      />
      <instancedMesh
        ref={handLRef}
        args={[HAND_GEO, SKIN_MATERIAL, count]}
      />
      <instancedMesh
        ref={handRRef}
        args={[HAND_GEO, SKIN_MATERIAL, count]}
      />

      {/* Thighs, Shins & Shoes */}
      <instancedMesh
        ref={thighLRef}
        args={[THIGH_GEO, PANTS_MATERIAL, count]}
      />
      <instancedMesh
        ref={thighRRef}
        args={[THIGH_GEO, PANTS_MATERIAL, count]}
      />
      <instancedMesh
        ref={shinLRef}
        args={[SHIN_GEO, PANTS_MATERIAL, count]}
      />
      <instancedMesh
        ref={shinRRef}
        args={[SHIN_GEO, PANTS_MATERIAL, count]}
      />
      <instancedMesh
        ref={shoeLRef}
        args={[SHOE_GEO, SHOE_MATERIAL, count]}
      />
      <instancedMesh
        ref={shoeRRef}
        args={[SHOE_GEO, SHOE_MATERIAL, count]}
      />

      {/* Accessories */}
      <instancedMesh
        ref={mugRef}
        args={[ACCESSORY_MUG_GEO, MUG_MATERIAL, count]}
      />

      {/* 3. Sleek Floating Chibi Overhead Nameplates (HTML Billboard with distance LOD) */}
      {visibleAgents.map((agent) => {
        const isSelected = selectedAgentId === agent.id;
        const simAgent = officeSimulationEngine.getAgent(agent.id);
        const isMoving = simAgent
          ? simAgent.state === "WALKING" || simAgent.state === "RUNNING" || simAgent.state === "APPROACHING_AGENT"
          : agent.isMoving;
        const isSeated = simAgent ? simAgent.isSeated : (agent.isSeated || Boolean(agent.assignedWorkstation));

        const posX = simAgent ? simAgent.position[0] : agent.position[0];
        const posY = simAgent ? simAgent.position[1] : agent.position[1];
        const posZ = isSeated && !isMoving && agent.assignedWorkstation
          ? agent.position[2] + 0.55
          : simAgent ? simAgent.position[2] : agent.position[2];

        const state = agent.behavioralState || "IDLE";
        const config = CANONICAL_STATE_CONFIGS[state] || CANONICAL_STATE_CONFIGS.IDLE;

        return (
          <group
            key={`nameplate-${agent.id}`}
            position={[posX, posY + 1.25, posZ]}
            onClick={(e) => {
              e.stopPropagation();
              onSelectAgent?.(agent.id);
            }}
          >
            <Html
              center
              distanceFactor={18}
              className="select-none pointer-events-auto cursor-pointer"
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAgent?.(agent.id);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-md transition-all duration-200 ${
                  isSelected
                    ? "bg-amber-500/95 border-2 border-amber-300 text-slate-950 font-black shadow-lg shadow-amber-500/50 scale-110"
                    : "bg-slate-950/80 border border-slate-700/80 hover:border-amber-400 text-slate-100 shadow-md hover:scale-105"
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full shadow-sm"
                  style={{ backgroundColor: config.beaconColor }}
                />
                <span className="text-[11px] font-bold tracking-tight whitespace-nowrap">
                  {agent.name.split(" ")[0]}
                </span>
                {agent.currentTaskTitle && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-amber-300 max-w-[80px] truncate">
                    {agent.currentTaskTitle}
                  </span>
                )}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
