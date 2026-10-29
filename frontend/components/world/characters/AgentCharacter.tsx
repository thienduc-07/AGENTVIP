"use client";

import React, { useRef, useMemo, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { AgentCharacterData } from "@/types";
import { useWorldStore } from "@/store/worldStore";
import { getGroundHeight } from "@/utils/terrainPhysics";
import { CREW_ISLAND_ROUTINES } from "@/utils/crewIslandRoutines";
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
  const isExecutingMission = useWorldStore((s) => s.isExecutingMission);

  const isSelected = selectedAgentId === agent.id;

  // Strict ground / platform height clamping to guarantee ZERO floating in mid-air
  const homeGroundY = useMemo(() => {
    if (agent.station === "captain_hq" && agent.appearance === "luffy-gear5") return 3.78;
    if (agent.appearance === "usopp") return 10.95;
    if (agent.appearance === "franky") return 5.1;
    if (agent.appearance === "robin") return 2.2;
    if (agent.appearance === "jinbe") return 0.55;
    if (agent.appearance === "brook") return 1.82;
    if (agent.appearance === "sanji") return 2.55;
    return getGroundHeight(agent.position[0], agent.position[2]);
  }, [agent.position, agent.station, agent.appearance]);

  const homePos = useMemo(
    () => new THREE.Vector3(agent.position[0], homeGroundY, agent.position[2]),
    [agent.position, homeGroundY]
  );

  const currentPos = useRef(homePos.clone());
  const currentQuat = useRef(new THREE.Quaternion());
  const targetQuat = useRef(new THREE.Quaternion());

  // Autonomous Crew Routine State Machine
  const [routineSpeech, setRoutineSpeech] = useState<string | null>(null);
  const [isWalkingLocomotion, setIsWalkingLocomotion] = useState<boolean>(false);
  const routineTarget = useRef<THREE.Vector3 | null>(null);
  const routinePhase = useRef<"at_home" | "walking_out" | "visiting" | "walking_home">("at_home");
  // Stagger initial wander timers across crew members so they don't all set off at once
  const routineTimer = useRef<number>(6.0 + Math.random() * 14.0);
  const routineIdx = useRef<number>(Math.floor(Math.random() * 3));
  const currentRoutineStayDuration = useRef<number>(14);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();

    const movingAgent = useWorldStore.getState().movingAgent;
    const isThisAgentTaskMoving = movingAgent && movingAgent.agentId === agent.id;

    // 1. SUPREME PRIORITY: Task Handoff Animation Movement
    if (isThisAgentTaskMoving) {
      const p = movingAgent.progress;
      const curX = THREE.MathUtils.lerp(movingAgent.fromPos[0], movingAgent.targetPos[0], p);
      const curZ = THREE.MathUtils.lerp(movingAgent.fromPos[2], movingAgent.targetPos[2], p);

      const terrainY = getGroundHeight(curX, curZ);
      const strideCadence = p * Math.PI * 14.0;
      const footfall = Math.abs(Math.sin(strideCadence)) * 0.04;
      const curY = terrainY + footfall;

      currentPos.current.set(curX, curY, curZ);
      groupRef.current.position.copy(currentPos.current);

      const dx = movingAgent.targetPos[0] - movingAgent.fromPos[0];
      const dz = movingAgent.targetPos[2] - movingAgent.fromPos[2];
      if (Math.hypot(dx, dz) > 0.01) {
        const targetAngle = Math.atan2(dx, dz);
        targetQuat.current.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
        groupRef.current.quaternion.slerp(targetQuat.current, Math.min(1.0, delta * 12.0));
      }
      return;
    }

    // 2. USER INTERACTION OR MISSION LOCK: Pause autonomous wandering
    if (isSelected || isExecutingMission || agent.status !== "idle") {
      if (routinePhase.current === "walking_out" || routinePhase.current === "walking_home") {
        setIsWalkingLocomotion(false);
      }
      // If at home, smoothly settle to home station
      if (routinePhase.current === "at_home") {
        currentPos.current.lerp(homePos, Math.min(1.0, delta * 5.0));
        groupRef.current.position.copy(currentPos.current);
      }
      return;
    }

    // 3. AUTONOMOUS CREW LIVING WORLD ROUTINES (Visiting friends & working across island)
    const routines = CREW_ISLAND_ROUTINES[agent.id] || [];
    routineTimer.current -= delta;

    if (routinePhase.current === "at_home") {
      // Resting / working at home station
      currentPos.current.lerp(homePos, Math.min(1.0, delta * 4.0));
      groupRef.current.position.copy(currentPos.current);

      // Default home orientation
      targetQuat.current.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      groupRef.current.quaternion.slerp(targetQuat.current, Math.min(1.0, delta * 3.0));

      if (routineTimer.current <= 0 && routines.length > 0) {
        // Depart on next excursion!
        const r = routines[routineIdx.current % routines.length];
        routineTarget.current = new THREE.Vector3(r.targetPos[0], r.targetPos[1], r.targetPos[2]);
        currentRoutineStayDuration.current = r.stayDuration;
        routinePhase.current = "walking_out";
        setIsWalkingLocomotion(true);
        useWorldStore.getState().setAgentActivity(agent.id, "strolling");
      }
    } else if (routinePhase.current === "walking_out" && routineTarget.current) {
      // Walking towards excursion destination
      const dest = routineTarget.current;
      const dx = dest.x - currentPos.current.x;
      const dz = dest.z - currentPos.current.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.4) {
        // Arrived at destination!
        const r = routines[routineIdx.current % routines.length];
        routinePhase.current = "visiting";
        setIsWalkingLocomotion(false);
        setRoutineSpeech(r.speech);
        useWorldStore.getState().setAgentActivity(agent.id, r.activity);
        routineTimer.current = r.stayDuration;
      } else {
        // Walk step towards destination
        const speed = 2.1 * delta;
        const step = Math.min(dist, speed);
        const curX = currentPos.current.x + (dx / dist) * step;
        const curZ = currentPos.current.z + (dz / dist) * step;
        const targetGroundY = dest.y > 4.5 ? dest.y : getGroundHeight(curX, curZ);
        const footfall = Math.abs(Math.sin(t * 9.0)) * 0.045;

        currentPos.current.set(curX, targetGroundY + footfall, curZ);
        groupRef.current.position.copy(currentPos.current);

        const targetAngle = Math.atan2(dx, dz);
        targetQuat.current.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
        groupRef.current.quaternion.slerp(targetQuat.current, Math.min(1.0, delta * 8.0));
      }
    } else if (routinePhase.current === "visiting") {
      // Social interaction / visiting activity at destination
      // Clear speech bubble after 7 seconds so it doesn't linger forever
      if (routineTimer.current < currentRoutineStayDuration.current - 7.0 && routineSpeech) {
        setRoutineSpeech(null);
      }

      if (routineTimer.current <= 0) {
        // Return journey back to home base!
        routinePhase.current = "walking_home";
        routineTarget.current = homePos;
        setIsWalkingLocomotion(true);
        setRoutineSpeech(null);
        useWorldStore.getState().setAgentActivity(agent.id, "strolling");
      }
    } else if (routinePhase.current === "walking_home") {
      // Walking back to home base station
      const dx = homePos.x - currentPos.current.x;
      const dz = homePos.z - currentPos.current.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.35) {
        // Arrived home!
        routinePhase.current = "at_home";
        setIsWalkingLocomotion(false);
        currentPos.current.copy(homePos);
        groupRef.current.position.copy(currentPos.current);

        // Restore original character activity
        const defaultActivityMap: Record<string, string> = {
          "agent-captain-roger": "haki",
          "agent-zoro-quartermaster": "sword_kata",
          "agent-sanji-cook": "cooking",
          "agent-franky-shipwright": "ship_repair",
          "agent-chopper-doctor": "apothecary",
          "agent-nami-navigator": "cartography",
          "agent-usopp-sniper": "sniper_scout",
          "agent-robin-archaeologist": "cien_fleurs",
          "agent-brook-musician": "violin_concert",
          "agent-jinbe-helmsman": "karate_kata",
        };
        useWorldStore.getState().setAgentActivity(agent.id, defaultActivityMap[agent.id] || "idle");
        // Rest at home for 16-26 seconds before next excursion
        routineTimer.current = 16.0 + Math.random() * 12.0;
        routineIdx.current += 1;
      } else {
        const speed = 2.0 * delta;
        const step = Math.min(dist, speed);
        const curX = currentPos.current.x + (dx / dist) * step;
        const curZ = currentPos.current.z + (dz / dist) * step;
        const curGroundY = homeGroundY > 4.5 ? homeGroundY : getGroundHeight(curX, curZ);
        const footfall = Math.abs(Math.sin(t * 9.0)) * 0.045;

        currentPos.current.set(curX, curGroundY + footfall, curZ);
        groupRef.current.position.copy(currentPos.current);

        const targetAngle = Math.atan2(dx, dz);
        targetQuat.current.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
        groupRef.current.quaternion.slerp(targetQuat.current, Math.min(1.0, delta * 8.0));
      }
    }
  });

  const movingAgent = useWorldStore((s) => s.movingAgent);
  const isThisAgentTaskMoving = Boolean(movingAgent && movingAgent.agentId === agent.id);
  const isActuallyMoving = isThisAgentTaskMoving || isWalkingLocomotion;

  return (
    <group
      ref={groupRef}
      position={[agent.position[0], homeGroundY, agent.position[2]]}
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
        isMoving={isActuallyMoving}
      />

      {/* 3D Visual Status Indicator with Sleek Ground Pill Badge & Manga Speech Bubble */}
      <AgentStatusIndicator
        status={agent.status}
        color={agent.color}
        name={agent.name}
        role={agent.role}
        currentTask={routineSpeech || agent.currentTask}
        isSelected={isSelected}
        onSelect={() => selectAgent(agent.id)}
        targetHeight={CHARACTER_SPECS[agent.appearance]?.targetHeight ?? 2.35}
      />
    </group>
  );
}
