"use client";

import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { AgentCharacterData } from "@/types";
import { useWorldStore } from "@/store/worldStore";
import { getGroundHeight } from "@/utils/terrainPhysics";
import AgentCharacterModel, { CHARACTER_SPECS } from "./AgentCharacterModel";
import AgentStatusIndicator from "./AgentStatusIndicator";

interface AgentCharacterProps {
  agent: AgentCharacterData;
}

export default function AgentCharacter({ agent }: AgentCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);

  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const selectAgent = useWorldStore((s) => s.selectAgent);
  const setHoveredAgent = useWorldStore((s) => s.setHoveredAgent);

  const isSelected = selectedAgentId === agent.id;

  // Track position smoothly without instant jumps or frame-by-frame React state re-renders
  const homePos = useMemo(
    () => new THREE.Vector3(agent.position[0], agent.position[1], agent.position[2]),
    [agent.position]
  );
  const currentPos = useRef(homePos.clone());
  const currentQuat = useRef(new THREE.Quaternion());
  const targetQuat = useRef(new THREE.Quaternion());

  useFrame((_, delta) => {
    const movingAgent = useWorldStore.getState().movingAgent;
    const isThisAgentMoving = movingAgent && movingAgent.agentId === agent.id;

    if (!groupRef.current) return;

    if (isThisAgentMoving) {
      // 1. Locomotion Movement Along Terrain Surface
      const p = movingAgent.progress;
      const curX = THREE.MathUtils.lerp(movingAgent.fromPos[0], movingAgent.targetPos[0], p);
      const curZ = THREE.MathUtils.lerp(movingAgent.fromPos[2], movingAgent.targetPos[2], p);

      // Follow true terrain height smoothly with natural footfall contact
      const terrainY = getGroundHeight(curX, curZ);
      const strideCadence = p * Math.PI * 14.0;
      const footfall = Math.abs(Math.sin(strideCadence)) * 0.04;
      const curY = terrainY + footfall;

      currentPos.current.set(curX, curY, curZ);
      groupRef.current.position.copy(currentPos.current);

      // 2. Smooth Quaternion Turning Towards Destination (Zero instant snapping)
      const dx = movingAgent.targetPos[0] - movingAgent.fromPos[0];
      const dz = movingAgent.targetPos[2] - movingAgent.fromPos[2];
      if (Math.hypot(dx, dz) > 0.01) {
        const targetAngle = Math.atan2(dx, dz);
        targetQuat.current.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
        groupRef.current.quaternion.slerp(targetQuat.current, Math.min(1.0, delta * 12.0));
      }
    } else {
      // 3. Smooth Home Station Alignment & Idle Resting Pose
      currentPos.current.lerp(homePos, Math.min(1.0, delta * 5.0));
      groupRef.current.position.copy(currentPos.current);

      // Smoothly restore default home orientation
      targetQuat.current.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      groupRef.current.quaternion.slerp(targetQuat.current, Math.min(1.0, delta * 4.0));
    }
  });

  const movingAgent = useWorldStore((s) => s.movingAgent);
  const isThisAgentMoving = Boolean(movingAgent && movingAgent.agentId === agent.id);

  return (
    <group
      ref={groupRef}
      position={[agent.position[0], agent.position[1], agent.position[2]]}
      onClick={(e) => {
        e.stopPropagation(); // Prevent ground click pass-through
        selectAgent(agent.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        setHoveredAgent(agent.id);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
        setHoveredAgent(null);
      }}
    >
      {/* Ground Contact Shadow Disc (Strictly pinned to terrain contact surface) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[0.55, 24]} />
        <meshBasicMaterial color="#020617" transparent opacity={0.45} />
      </mesh>

      {/* 3D Stylized Straw Hat Anime Character Model with Locomotion State */}
      <AgentCharacterModel
        agentId={agent.id}
        appearance={agent.appearance}
        color={agent.color}
        status={agent.status}
        isMoving={isThisAgentMoving}
      />

      {/* 3D Visual Status Indicator & HTML Overlay */}
      <AgentStatusIndicator
        status={agent.status}
        color={agent.color}
        name={agent.name}
        role={agent.role}
        currentTask={agent.currentTask}
        isSelected={isSelected}
        onSelect={() => selectAgent(agent.id)}
        targetHeight={CHARACTER_SPECS[agent.appearance]?.targetHeight ?? 2.35}
      />
    </group>
  );
}
