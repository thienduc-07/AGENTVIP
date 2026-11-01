"use client";

import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { AgentCharacterData } from "@/types";
import { useWorldStore } from "@/store/worldStore";
import { computeHeadingRadians, lerpAngleRadians } from "@/lib/spatialMovement";
import CorporateAgentAvatar from "./CorporateAgentAvatar";
import AgentStatusIndicator from "./AgentStatusIndicator";

interface AgentCharacterProps {
  agent: AgentCharacterData;
}

export default function AgentCharacter({ agent }: AgentCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const avatarRotationRef = useRef<THREE.Group>(null);
  const currentHeadingRef = useRef<number>(agent.headingRadians ?? 0);

  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const selectAgent = useWorldStore((s) => s.selectAgent);
  const setHoveredAgent = useWorldStore((s) => s.setHoveredAgent);
  const smoothFocusCamera = useWorldStore((s) => s.smoothFocusCamera);

  const isSelected = selectedAgentId === agent.id;

  const homePos = useMemo(
    () => new THREE.Vector3(agent.position[0], 0, agent.position[2]),
    [agent.position]
  );

  const currentPos = useRef(homePos.clone());

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const storeState = useWorldStore.getState();
    const movingAgent = storeState.movingAgent;
    const isThisAgentTaskMoving = movingAgent && movingAgent.agentId === agent.id;

    if (isThisAgentTaskMoving) {
      const p = movingAgent.progress;
      const curX = THREE.MathUtils.lerp(movingAgent.fromPos[0], movingAgent.targetPos[0], p);
      const curZ = THREE.MathUtils.lerp(movingAgent.fromPos[2], movingAgent.targetPos[2], p);
      // Slight arc height during data transfer
      const curY = Math.sin(p * Math.PI) * 0.4;

      const targetHeading = computeHeadingRadians(
        [currentPos.current.x, 0, currentPos.current.z],
        [movingAgent.targetPos[0], 0, movingAgent.targetPos[2]],
        currentHeadingRef.current
      );
      currentHeadingRef.current = lerpAngleRadians(
        currentHeadingRef.current,
        targetHeading,
        Math.min(1, delta * 10)
      );

      currentPos.current.set(curX, curY, curZ);
      groupRef.current.position.copy(currentPos.current);
    } else {
      const liveAgent = storeState.agents[agent.id] || agent;
      if (liveAgent.isMoving && liveAgent.movementPlan) {
        storeState.stepAgentSpatialMovement(agent.id, delta);
      }
      const updatedAgent = useWorldStore.getState().agents[agent.id] || liveAgent;
      const targetVec = new THREE.Vector3(
        updatedAgent.position[0],
        0,
        updatedAgent.position[2]
      );

      if (updatedAgent.isMoving) {
        currentPos.current.lerp(targetVec, Math.min(1, delta * 16));
      } else {
        currentPos.current.lerp(targetVec, Math.min(1, delta * 10));
      }
      groupRef.current.position.copy(currentPos.current);

      if (typeof updatedAgent.headingRadians === "number") {
        currentHeadingRef.current = lerpAngleRadians(
          currentHeadingRef.current,
          updatedAgent.headingRadians,
          Math.min(1, delta * 10)
        );
      }
    }

    if (avatarRotationRef.current) {
      avatarRotationRef.current.rotation.y = currentHeadingRef.current;
    }
  });

  const handleClick = (e: any) => {
    e.stopPropagation();
    selectAgent(agent.id);
    smoothFocusCamera(
      [agent.position[0], 6.5, agent.position[2] + 6],
      [agent.position[0], 1.2, agent.position[2]]
    );
  };

  const isWalking = Boolean(
    agent.isMoving || agent.behavioralState === "MOVING"
  );

  return (
    <group
      ref={groupRef}
      position={[agent.position[0], 0, agent.position[2]]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHoveredAgent(agent.id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHoveredAgent(null);
        document.body.style.cursor = "auto";
      }}
    >
      {/* Rotatable 3D Stylized Corporate Professional Avatar */}
      <group ref={avatarRotationRef}>
        <CorporateAgentAvatar
          status={agent.status}
          behavioralState={agent.behavioralState}
          color={agent.color}
          appearance={agent.appearance}
          isWorking={agent.status === "working" && !isWalking}
          isMoving={isWalking}
        />
      </group>

      {/* Floating Status Ring, Department Title & Approval Beacon */}
      <AgentStatusIndicator
        status={agent.status}
        behavioralState={agent.behavioralState}
        color={agent.color}
        name={agent.name}
        role={agent.role}
        currentTask={agent.currentTask}
        isSelected={isSelected}
        onSelect={() => selectAgent(agent.id)}
        targetHeight={2.2}
      />
    </group>
  );
}
