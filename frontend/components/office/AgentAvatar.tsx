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
  meetingState?:
    | "IDLE"
    | "WALKING_TO_MEETING"
    | "ARRIVING"
    | "SITTING"
    | "LISTENING"
    | "THINKING"
    | "SPEAKING"
    | "PRESENTING"
    | "VOTING"
    | "WAITING"
    | "LEAVING";
  isSeated?: boolean;
}

interface AgentAvatarProps {
  data: AgentAvatarData;
  isSelected?: boolean;
  onSelect?: (agentId: string) => void;
}

// Shared Avatar Geometries (Singletons reused across all agents to eliminate memory churn)
const PELVIS_GEOMETRY = new THREE.BoxGeometry(0.32, 0.14, 0.22);
const TORSO_GEOMETRY = new THREE.BoxGeometry(0.38, 0.42, 0.24);
const SHIRT_GEOMETRY = new THREE.PlaneGeometry(0.16, 0.32);
const TIE_GEOMETRY = new THREE.BoxGeometry(0.04, 0.22, 0.005);
const NECK_GEOMETRY = new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.13, 12, 12);
const HAIR_GEOMETRY = new THREE.BoxGeometry(0.26, 0.14, 0.26);
const ARM_GEOMETRY = new THREE.CylinderGeometry(0.05, 0.045, 0.36, 8);
const HAND_GEOMETRY = new THREE.SphereGeometry(0.04, 8, 8);
const LEG_GEOMETRY = new THREE.CylinderGeometry(0.065, 0.055, 0.74, 8);
const SHOE_GEOMETRY = new THREE.BoxGeometry(0.1, 0.07, 0.22);
const RING_GEOMETRY = new THREE.RingGeometry(0.45, 0.58, 24);

// Shared Avatar Materials (Singletons reused across all agents)
const PELVIS_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.6 });
const TORSO_MATERIAL = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.5 });
const SHIRT_MATERIAL = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.3 });
const SKIN_NECK_MATERIAL = new THREE.MeshStandardMaterial({ color: "#fed7aa", roughness: 0.7 });
const SKIN_HEAD_MATERIAL = new THREE.MeshStandardMaterial({ color: "#fed7aa", roughness: 0.6 });
const HAIR_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.4 });
const SUIT_ARM_MATERIAL = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.5 });
const SKIN_HAND_MATERIAL = new THREE.MeshStandardMaterial({ color: "#fed7aa", roughness: 0.7 });
const PANTS_LEG_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.7 });
const SHOE_MATERIAL = new THREE.MeshStandardMaterial({ color: "#090d16", roughness: 0.3, metalness: 0.4 });
const RING_SELECTED_MATERIAL = new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.85 });
const RING_HOVER_MATERIAL = new THREE.MeshBasicMaterial({ color: "#94a3b8", transparent: true, opacity: 0.45 });

// Memoized Accent Tie Materials Map
const TIE_MATERIALS = new Map<string, THREE.MeshStandardMaterial>();
function getTieMaterial(color: string): THREE.MeshStandardMaterial {
  let mat = TIE_MATERIALS.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
    });
    TIE_MATERIALS.set(color, mat);
  }
  return mat;
}

function AgentAvatar({
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

    // B. Legs Walk Animation vs Sitting
    if (leftLegRef.current && rightLegRef.current) {
      if (data.isSeated) {
        // Seated posture: legs bent at 90 degrees
        leftLegRef.current.rotation.x = -1.48;
        rightLegRef.current.rotation.x = -1.48;
      } else if (isMoving) {
        leftLegRef.current.rotation.x = Math.sin(t * 9.0) * 0.45;
        rightLegRef.current.rotation.x = -Math.sin(t * 9.0) * 0.45;
      } else {
        leftLegRef.current.rotation.x = THREE.MathUtils.lerp(leftLegRef.current.rotation.x, 0, 0.2);
        rightLegRef.current.rotation.x = THREE.MathUtils.lerp(rightLegRef.current.rotation.x, 0, 0.2);
      }
    }

    // C. Arms State-Based Animation
    if (leftArmRef.current && rightArmRef.current) {
      // 1. Meeting Specific Animations
      if (data.meetingState === "SPEAKING") {
        // Active speaking gesture: rhythmic arm movement & forward engagement
        leftArmRef.current.rotation.x = -1.1 + Math.sin(t * 6.5) * 0.22;
        leftArmRef.current.rotation.z = 0.25;
        rightArmRef.current.rotation.x = -1.0 + Math.cos(t * 6.5) * 0.22;
        rightArmRef.current.rotation.z = -0.25;
      } else if (data.meetingState === "PRESENTING") {
        // Keynote / Presenting: right arm outstretched towards presentation display
        leftArmRef.current.rotation.x = -0.6;
        leftArmRef.current.rotation.z = 0.2;
        rightArmRef.current.rotation.x = -1.7 + Math.sin(t * 2.0) * 0.08;
        rightArmRef.current.rotation.z = -0.4;
      } else if (data.meetingState === "VOTING") {
        // Voting: right arm raised high in vote
        leftArmRef.current.rotation.x = -1.0;
        leftArmRef.current.rotation.z = 0.15;
        rightArmRef.current.rotation.x = -2.6 + Math.sin(t * 2.0) * 0.05;
        rightArmRef.current.rotation.z = -0.2;
      } else if (data.meetingState === "THINKING") {
        // Hand to chin contemplation
        leftArmRef.current.rotation.x = -1.0;
        leftArmRef.current.rotation.z = 0.25;
        rightArmRef.current.rotation.x = -1.55 + Math.sin(t * 1.5) * 0.05;
        rightArmRef.current.rotation.z = 0.35;
      } else if (data.isSeated) {
        // Neutral seated position: forearms resting on conference table
        leftArmRef.current.rotation.x = -1.0 + Math.sin(t * 1.8) * 0.02;
        leftArmRef.current.rotation.z = 0.18;
        rightArmRef.current.rotation.x = -1.0 + Math.cos(t * 1.8) * 0.02;
        rightArmRef.current.rotation.z = -0.18;
      } else if (isMoving) {
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
        <mesh
          position={[0, 0.01, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={RING_GEOMETRY}
          material={isSelected ? RING_SELECTED_MATERIAL : RING_HOVER_MATERIAL}
        />
      )}

      {/* 2. Character Model (Modern Proportional PBR Stylized Humanoid) */}
      <group position={[0, 0, 0]}>
        {/* Pelvis / Hips */}
        <mesh
          position={[0, 0.82, 0]}
          geometry={PELVIS_GEOMETRY}
          material={PELVIS_MATERIAL}
        />

        {/* Torso & Suit Jacket (Primary body shadow caster) */}
        <mesh
          position={[0, 1.08, 0]}
          geometry={TORSO_GEOMETRY}
          material={TORSO_MATERIAL}
          castShadow
        />

        {/* Corporate Shirt & Tie / Accent Lanyard */}
        <mesh
          position={[0, 1.1, 0.125]}
          geometry={SHIRT_GEOMETRY}
          material={SHIRT_MATERIAL}
        />
        <mesh
          position={[0, 1.08, 0.128]}
          geometry={TIE_GEOMETRY}
          material={getTieMaterial(accentColor)}
        />

        {/* Head & Neck */}
        <group ref={headRef} position={[0, 1.42, 0]}>
          {/* Neck */}
          <mesh
            position={[0, -0.06, 0]}
            geometry={NECK_GEOMETRY}
            material={SKIN_NECK_MATERIAL}
          />
          {/* Head Base */}
          <mesh
            position={[0, 0.08, 0]}
            geometry={HEAD_GEOMETRY}
            material={SKIN_HEAD_MATERIAL}
          />
          {/* Stylized Hair */}
          <mesh
            position={[0, 0.15, -0.02]}
            geometry={HAIR_GEOMETRY}
            material={HAIR_MATERIAL}
          />
        </group>

        {/* Left Arm */}
        <group ref={leftArmRef} position={[-0.24, 1.25, 0]}>
          <mesh
            position={[0, -0.18, 0]}
            geometry={ARM_GEOMETRY}
            material={SUIT_ARM_MATERIAL}
          />
          {/* Hand */}
          <mesh
            position={[0, -0.38, 0]}
            geometry={HAND_GEOMETRY}
            material={SKIN_HAND_MATERIAL}
          />
        </group>

        {/* Right Arm */}
        <group ref={rightArmRef} position={[0.24, 1.25, 0]}>
          <mesh
            position={[0, -0.18, 0]}
            geometry={ARM_GEOMETRY}
            material={SUIT_ARM_MATERIAL}
          />
          {/* Hand */}
          <mesh
            position={[0, -0.38, 0]}
            geometry={HAND_GEOMETRY}
            material={SKIN_HAND_MATERIAL}
          />
        </group>

        {/* Left Leg */}
        <group ref={leftLegRef} position={[-0.1, 0.75, 0]}>
          <mesh
            position={[0, -0.36, 0]}
            geometry={LEG_GEOMETRY}
            material={PANTS_LEG_MATERIAL}
          />
          {/* Shoe */}
          <mesh
            position={[0, -0.74, 0.05]}
            geometry={SHOE_GEOMETRY}
            material={SHOE_MATERIAL}
          />
        </group>

        {/* Right Leg */}
        <group ref={rightLegRef} position={[0.1, 0.75, 0]}>
          <mesh
            position={[0, -0.36, 0]}
            geometry={LEG_GEOMETRY}
            material={PANTS_LEG_MATERIAL}
          />
          {/* Shoe */}
          <mesh
            position={[0, -0.74, 0.05]}
            geometry={SHOE_GEOMETRY}
            material={SHOE_MATERIAL}
          />
        </group>
      </group>

      {/* 3. Floating 3D Billboard Name & Status Badge */}
      <Html position={[0, 1.95, 0]} center distanceFactor={14}>
        <div className="select-none flex flex-col items-center">
          {/* Active Speaking Indicator in Meeting */}
          {data.meetingState === "SPEAKING" && (
            <div className="mb-1.5 px-2.5 py-0.5 rounded-full bg-emerald-600/95 text-[10px] font-semibold text-white shadow-md border border-emerald-400/50 flex items-center gap-1.5 animate-bounce">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              <span>ĐANG PHÁT BIỂU</span>
            </div>
          )}

          {/* Active Voting Indicator in Meeting */}
          {data.meetingState === "VOTING" && (
            <div className="mb-1.5 px-2.5 py-0.5 rounded-full bg-amber-600/95 text-[10px] font-semibold text-white shadow-md border border-amber-400/50 flex items-center gap-1.5 animate-pulse">
              <span>ĐANG BIỂU QUYẾT</span>
            </div>
          )}

          {/* Active Task Floating Pill if Working */}
          {data.currentTaskTitle && data.behavioralState === "IN_PROGRESS" && !data.meetingState && (
            <div className="mb-1.5 px-2.5 py-0.5 rounded-full bg-blue-600/95 text-[10px] font-medium text-white shadow-md border border-blue-400/50 flex items-center gap-1.5 max-w-[190px] truncate animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
              <span className="truncate">{data.currentTaskTitle}</span>
            </div>
          )}

          {/* Name & Role Card */}
          <div
            data-testid={`agent-card-${data.id}`}
            onClick={handleClick}
            className={`pointer-events-auto cursor-pointer px-2.5 py-1 rounded-lg backdrop-blur-md shadow-xl border transition-all duration-150 flex items-center gap-2 ${
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

export default React.memo(AgentAvatar, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.data.id === next.data.id &&
    prev.data.behavioralState === next.data.behavioralState &&
    prev.data.meetingState === next.data.meetingState &&
    prev.data.currentTaskTitle === next.data.currentTaskTitle &&
    prev.data.isMoving === next.data.isMoving &&
    prev.data.isSeated === next.data.isSeated &&
    prev.data.assignedWorkstation === next.data.assignedWorkstation &&
    prev.data.position[0] === next.data.position[0] &&
    prev.data.position[1] === next.data.position[1] &&
    prev.data.position[2] === next.data.position[2] &&
    prev.data.headingRadians === next.data.headingRadians
  );
});

