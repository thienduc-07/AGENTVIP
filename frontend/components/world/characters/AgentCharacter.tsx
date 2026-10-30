"use client";

import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { AgentCharacterData } from "@/types";
import { useWorldStore } from "@/store/worldStore";
import CorporateAgentAvatar from "./CorporateAgentAvatar";
import AgentStatusIndicator from "./AgentStatusIndicator";

interface AgentCharacterProps {
  agent: AgentCharacterData;
}

export default function AgentCharacter({ agent }: AgentCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);

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

  useFrame(() => {
    if (!groupRef.current) return;

    const movingAgent = useWorldStore.getState().movingAgent;
    const isThisAgentTaskMoving = movingAgent && movingAgent.agentId === agent.id;

    if (isThisAgentTaskMoving) {
      const p = movingAgent.progress;
      const curX = THREE.MathUtils.lerp(movingAgent.fromPos[0], movingAgent.targetPos[0], p);
      const curZ = THREE.MathUtils.lerp(movingAgent.fromPos[2], movingAgent.targetPos[2], p);
      // Slight arc height during data transfer
      const curY = Math.sin(p * Math.PI) * 0.4;

      currentPos.current.set(curX, curY, curZ);
      groupRef.current.position.copy(currentPos.current);
    } else {
      // Return smoothly to home position
      currentPos.current.lerp(homePos, 0.1);
      groupRef.current.position.copy(currentPos.current);
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
      {/* 3D Stylized Corporate Professional Avatar */}
      <CorporateAgentAvatar
        status={agent.status}
        color={agent.color}
        appearance={agent.appearance}
        isWorking={agent.status === "working"}
      />

      {/* Floating Status Ring, Department Title & Approval Beacon */}
      <AgentStatusIndicator
        status={agent.status}
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
