"use client";

import React, { useRef, useState, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { CanonicalAgentState, CANONICAL_STATE_CONFIGS } from "@/types/office";

export interface AgentAvatarData {
  id: string;
  name: string;
  role: string;
  department: string;
  color?: string;
  position: [number, number, number];
  targetPosition?: [number, number, number] | null;
  headingRadians?: number;
  behavioralState: CanonicalAgentState;
  operationalStatus?: string;
  currentTaskTitle?: string | null;
  assignedWorkstation?: string | null;
  isMoving?: boolean;
  waypoints?: Array<{ x: number; y: number; z: number }> | null;
}

interface AgentAvatarProps {
  data: AgentAvatarData;
  isSelected?: boolean;
  onSelect?: (agentId: string) => void;
}

export default function AgentAvatar({
  data,
  isSelected = false,
  onSelect,
}: AgentAvatarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  const [isHovered, setIsHovered] = useState(false);

  const stateConfig = CANONICAL_STATE_CONFIGS[data.behavioralState] || CANONICAL_STATE_CONFIGS.IDLE;
  const accentColor = data.color || "#38bdf8";

  const currentPos = useRef(new THREE.Vector3(...data.position));
  const currentHeading = useRef(data.headingRadians ?? 0);
  const waypointIndexRef = useRef<number>(0);

  // Smooth position lerping, waypoint queue traversal, and articulated animation loop
  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const t = state.clock.getElapsedTime();
    const isMoving = data.isMoving || (data.targetPosition !== null && data.targetPosition !== undefined);

    // 1. Determine active goal (waypoint traversal vs target destination)
    let activeGoal: THREE.Vector3;
    if (isMoving && data.waypoints && data.waypoints.length > 0) {
      const idx = Math.min(waypointIndexRef.current, data.waypoints.length - 1);
      const wp = data.waypoints[idx];
      activeGoal = new THREE.Vector3(wp.x, wp.y ?? 1.0, wp.z);
      if (currentPos.current.distanceTo(activeGoal) < 0.35 && idx < data.waypoints.length - 1) {
        waypointIndexRef.current += 1;
        const nextWp = data.waypoints[waypointIndexRef.current];
        activeGoal = new THREE.Vector3(nextWp.x, nextWp.y ?? 1.0, nextWp.z);
      }
    } else if (data.targetPosition) {
      activeGoal = new THREE.Vector3(...data.targetPosition);
    } else {
      activeGoal = new THREE.Vector3(...data.position);
    }

    if (isMoving) {
      currentPos.current.lerp(activeGoal, Math.min(1, delta * 8));

      // Calculate movement heading towards active waypoint/target
      const diffX = activeGoal.x - currentPos.current.x;
      const diffZ = activeGoal.z - currentPos.current.z;
      if (Math.abs(diffX) > 0.04 || Math.abs(diffZ) > 0.04) {
        const targetHeading = Math.atan2(diffX, diffZ);
        currentHeading.current = THREE.MathUtils.lerp(
          currentHeading.current,
          targetHeading,
          Math.min(1, delta * 10)
        );
      }
    } else {
      currentPos.current.lerp(activeGoal, Math.min(1, delta * 12));
      // When docked at workstation, smoothly orient facing monitors (-Z axis = Math.PI)
      const targetHeading = data.assignedWorkstation
        ? Math.PI
        : data.headingRadians ?? currentHeading.current;
      currentHeading.current = THREE.MathUtils.lerp(
        currentHeading.current,
        targetHeading,
        Math.min(1, delta * 8)
      );
      waypointIndexRef.current = 0;
    }

    groupRef.current.position.copy(currentPos.current);
    groupRef.current.rotation.y = currentHeading.current;

    // 2. Articulated Animation states
    // A. Breathing vs Walk Bounce
    if (isMoving) {
      groupRef.current.position.y = (currentPos.current.y || 0) + Math.abs(Math.sin(t * 9.0)) * 0.05;
    } else {
      groupRef.current.position.y = (currentPos.current.y || 0) + Math.sin(t * 1.8) * 0.015;
    }

    // B. Legs Walk Animation
    if (leftLegRef.current && rightLegRef.current) {
      if (isMoving) {
        leftLegRef.current.rotation.x = Math.sin(t * 9.0) * 0.45;
        rightLegRef.current.rotation.x = -Math.sin(t * 9.0) * 0.45;
      } else {
        leftLegRef.current.rotation.x = THREE.MathUtils.lerp(leftLegRef.current.rotation.x, 0, 0.2);
        rightLegRef.current.rotation.x = THREE.MathUtils.lerp(rightLegRef.current.rotation.x, 0, 0.2);
      }
    }

    // C. Arms State-Based Animation
    if (leftArmRef.current && rightArmRef.current) {
      if (isMoving) {
        // Natural walking arm counter-swing
        leftArmRef.current.rotation.x = -0.2 - Math.sin(t * 9.0) * 0.38;
        leftArmRef.current.rotation.z = 0.15;
        rightArmRef.current.rotation.x = -0.2 + Math.sin(t * 9.0) * 0.38;
        rightArmRef.current.rotation.z = -0.15;
      } else if (data.behavioralState === "IN_PROGRESS") {
        // Fast typing / tool invocation posture
        leftArmRef.current.rotation.x = -1.25 + Math.sin(t * 16.0) * 0.14;
        leftArmRef.current.rotation.z = 0.32 + Math.cos(t * 14.0) * 0.08;
        rightArmRef.current.rotation.x = -1.25 + Math.cos(t * 15.0) * 0.14;
        rightArmRef.current.rotation.z = -0.32 + Math.sin(t * 15.0) * 0.08;
      } else if (data.behavioralState === "WAITING") {
        // Arms folded / waiting posture
        leftArmRef.current.rotation.x = -0.9;
        leftArmRef.current.rotation.z = 0.55;
        rightArmRef.current.rotation.x = -0.9;
        rightArmRef.current.rotation.z = -0.55;
      } else if (data.behavioralState === "REVIEW") {
        // One hand on chin, one inspecting
        leftArmRef.current.rotation.x = -1.4 + Math.sin(t * 1.5) * 0.05;
        leftArmRef.current.rotation.z = 0.25;
        rightArmRef.current.rotation.x = -0.5;
        rightArmRef.current.rotation.z = -0.2;
      } else if (data.behavioralState === "COMPLETED") {
        // Subtle triumphant rest
        leftArmRef.current.rotation.x = -0.25 + Math.sin(t * 2.5) * 0.08;
        rightArmRef.current.rotation.x = -0.25 + Math.sin(t * 2.5) * 0.08;
      } else if (data.behavioralState === "FAILED") {
        // Downcast head and arms
        leftArmRef.current.rotation.x = 0.15;
        rightArmRef.current.rotation.x = 0.15;
      } else {
        // IDLE / CANCELLED natural resting loop
        leftArmRef.current.rotation.x = -0.25 + Math.sin(t * 1.6) * 0.04;
        leftArmRef.current.rotation.z = 0.18;
        rightArmRef.current.rotation.x = -0.25 + Math.cos(t * 1.6) * 0.04;
        rightArmRef.current.rotation.z = -0.18;
      }
    }

    // D. Head Glance
    if (headRef.current) {
      if (data.behavioralState === "FAILED") {
        headRef.current.rotation.x = 0.25; // Head down
      } else {
        headRef.current.rotation.x = Math.sin(t * 1.1) * 0.04;
        headRef.current.rotation.y = Math.sin(t * 0.7) * 0.08;
      }
    }
  });

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect(data.id);
    }
  };

  return (
    <group
      ref={groupRef}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
      }}
      onPointerOut={() => setIsHovered(false)}
    >
      {/* 1. Selection & Hover Floor Ring */}
      {(isSelected || isHovered) && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.45, 0.58, 32]} />
          <meshBasicMaterial
            color={isSelected ? "#38bdf8" : "#94a3b8"}
            transparent
            opacity={isSelected ? 0.85 : 0.45}
          />
        </mesh>
      )}

      {/* 2. Character Model (Modern Proportional PBR Stylized Humanoid) */}
      <group position={[0, 0, 0]}>
        {/* Pelvis / Hips */}
        <mesh position={[0, 0.82, 0]} castShadow>
          <boxGeometry args={[0.32, 0.14, 0.22]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>

        {/* Torso & Suit Jacket */}
        <mesh position={[0, 1.08, 0]} castShadow>
          <boxGeometry args={[0.38, 0.42, 0.24]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} />
        </mesh>

        {/* Corporate Shirt & Tie / Accent Lanyard */}
        <mesh position={[0, 1.1, 0.125]}>
          <planeGeometry args={[0.16, 0.32]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.08, 0.128]}>
          <boxGeometry args={[0.04, 0.22, 0.005]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.3}
          />
        </mesh>

        {/* Head & Neck */}
        <group ref={headRef} position={[0, 1.42, 0]}>
          {/* Neck */}
          <mesh position={[0, -0.06, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.07, 0.1, 12]} />
            <meshStandardMaterial color="#fed7aa" roughness={0.7} />
          </mesh>
          {/* Head Base */}
          <mesh position={[0, 0.08, 0]} castShadow>
            <sphereGeometry args={[0.13, 16, 16]} />
            <meshStandardMaterial color="#fed7aa" roughness={0.6} />
          </mesh>
          {/* Stylized Hair */}
          <mesh position={[0, 0.15, -0.02]} castShadow>
            <boxGeometry args={[0.26, 0.14, 0.26]} />
            <meshStandardMaterial color="#1e293b" roughness={0.4} />
          </mesh>
        </group>

        {/* Left Arm */}
        <group ref={leftArmRef} position={[-0.24, 1.25, 0]}>
          <mesh position={[0, -0.18, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.045, 0.36, 10]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} />
          </mesh>
          {/* Hand */}
          <mesh position={[0, -0.38, 0]} castShadow>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#fed7aa" roughness={0.7} />
          </mesh>
        </group>

        {/* Right Arm */}
        <group ref={rightArmRef} position={[0.24, 1.25, 0]}>
          <mesh position={[0, -0.18, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.045, 0.36, 10]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} />
          </mesh>
          {/* Hand */}
          <mesh position={[0, -0.38, 0]} castShadow>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#fed7aa" roughness={0.7} />
          </mesh>
        </group>

        {/* Left Leg */}
        <group ref={leftLegRef} position={[-0.1, 0.75, 0]}>
          <mesh position={[0, -0.36, 0]} castShadow>
            <cylinderGeometry args={[0.065, 0.055, 0.74, 10]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
          {/* Shoe */}
          <mesh position={[0, -0.74, 0.05]} castShadow>
            <boxGeometry args={[0.1, 0.07, 0.22]} />
            <meshStandardMaterial color="#090d16" roughness={0.3} metalness={0.4} />
          </mesh>
        </group>

        {/* Right Leg */}
        <group ref={rightLegRef} position={[0.1, 0.75, 0]}>
          <mesh position={[0, -0.36, 0]} castShadow>
            <cylinderGeometry args={[0.065, 0.055, 0.74, 10]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
          {/* Shoe */}
          <mesh position={[0, -0.74, 0.05]} castShadow>
            <boxGeometry args={[0.1, 0.07, 0.22]} />
            <meshStandardMaterial color="#090d16" roughness={0.3} metalness={0.4} />
          </mesh>
        </group>
      </group>

      {/* 3. Floating 3D Billboard Name & Status Badge */}
      <Html position={[0, 1.95, 0]} center distanceFactor={14}>
        <div className="pointer-events-none select-none flex flex-col items-center">
          {/* Active Task Floating Pill if Working */}
          {data.currentTaskTitle && data.behavioralState === "IN_PROGRESS" && (
            <div className="mb-1.5 px-2.5 py-0.5 rounded-full bg-blue-600/95 text-[10px] font-medium text-white shadow-md border border-blue-400/50 flex items-center gap-1.5 max-w-[190px] truncate animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
              <span className="truncate">{data.currentTaskTitle}</span>
            </div>
          )}

          {/* Name & Role Card */}
          <div
            className={`px-2.5 py-1 rounded-lg backdrop-blur-md shadow-xl border transition-all duration-150 flex items-center gap-2 ${
              isSelected
                ? "bg-slate-900/95 border-sky-400 scale-105 ring-2 ring-sky-400/30"
                : isHovered
                ? "bg-slate-900/90 border-slate-600"
                : "bg-slate-950/80 border-slate-800"
            }`}
          >
            {/* Status Beacon Dot */}
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
              style={{
                backgroundColor: stateConfig.beaconColor,
                boxShadow: `0 0 8px ${stateConfig.beaconColor}`,
              }}
            />
            <div className="flex flex-col text-left whitespace-nowrap">
              <span className="text-xs font-semibold text-slate-100">{data.name}</span>
              <span className="text-[10px] text-slate-400">
                {data.role} • <span style={{ color: stateConfig.beaconColor }}>{stateConfig.label}</span>
              </span>
            </div>
          </div>
        </div>
      </Html>
    </group>
  );
}

