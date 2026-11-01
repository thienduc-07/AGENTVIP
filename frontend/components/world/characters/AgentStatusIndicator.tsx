"use client";

import React, { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import { WorldAgentStatus, AgentBehavioralState } from "@/types";

interface AgentStatusIndicatorProps {
  status: WorldAgentStatus;
  behavioralState?: AgentBehavioralState;
  color: string;
  name: string;
  role: string;
  currentTask?: string | null;
  isSelected: boolean;
  onSelect: () => void;
  targetHeight?: number;
}

export default function AgentStatusIndicator({
  status,
  behavioralState,
  color,
  name,
  role,
  currentTask,
  isSelected,
  onSelect,
  targetHeight = 2.3,
}: AgentStatusIndicatorProps) {
  const baseRingRef = useRef<THREE.Mesh>(null);
  const runesRef = useRef<THREE.Group>(null);
  const alertMarkerRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    if (baseRingRef.current) {
      if (status === "working" || behavioralState === "MOVING") {
        baseRingRef.current.rotation.z = t * 3.5;
        baseRingRef.current.scale.setScalar(1 + Math.sin(t * 8) * 0.12);
      } else if (status === "waiting_approval" || behavioralState === "WAITING") {
        baseRingRef.current.rotation.z = t * 0.8;
        baseRingRef.current.scale.setScalar(1 + Math.sin(t * 6) * 0.22);
      } else {
        baseRingRef.current.rotation.z = t * 0.4;
        baseRingRef.current.scale.setScalar(1);
      }
    }

    if (runesRef.current && status === "working") {
      runesRef.current.rotation.y = t * 2.8;
    }

    if (alertMarkerRef.current && status === "waiting_approval") {
      alertMarkerRef.current.rotation.y = t * 3.2;
      alertMarkerRef.current.position.y = 2.65 + Math.sin(t * 5) * 0.12;
    }
  });

  const getStatusColor = () => {
    if (behavioralState === "MOVING") return "#38bdf8"; // Sky blue navigation
    if (behavioralState === "PLANNING" || behavioralState === "THINKING") return "#a855f7"; // Violet cognition
    if (behavioralState === "COMMUNICATING") return "#06b6d4"; // Cyan coordination
    switch (status) {
      case "working":
        return "#f59e0b"; // Amber working
      case "waiting_approval":
        return "#ef4444"; // Hazard red
      case "error":
        return "#f43f5e"; // Rose
      case "offline":
        return "#64748b"; // Grey
      default:
        return color || "#10b981"; // Ready
    }
  };

  const getStatusLabel = () => {
    if (status === "offline") return "OFFLINE";
    if (behavioralState && behavioralState !== "IDLE") {
      return behavioralState;
    }
    switch (status) {
      case "working":
        return "WORKING";
      case "waiting_approval":
        return "AWAITING APPROVAL";
      case "error":
        return "ERROR";
      default:
        return "READY";
    }
  };

  const statusColor = getStatusColor();
  // Full Display Name for Pill Badge
  const displayName = name.replace(/^\d+\.\s*/, ""); // remove leading number if any
  const statusLabel = getStatusLabel();

  return (
    <group>
      {/* --- 3D GROUND STATUS RING --- */}
      <mesh
        ref={baseRingRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.035, 0]}
      >
        <ringGeometry args={[0.72, 0.88, 32]} />
        <meshBasicMaterial
          color={statusColor}
          side={THREE.DoubleSide}
          transparent
          opacity={status === "idle" ? 0.45 : 0.9}
          depthWrite={false}
        />
      </mesh>

      {/* Selected Indicator Halo */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[0.95, 1.08, 32]} />
          <meshBasicMaterial
            color="#f59e0b"
            side={THREE.DoubleSide}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* --- WORKING STATUS: ORBITING RUNE RINGS --- */}
      {status === "working" && (
        <group ref={runesRef} position={[0, 0.8, 0]}>
          <mesh rotation={[0.4, 0, 0]}>
            <torusGeometry args={[0.65, 0.03, 8, 24]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          <mesh rotation={[-0.4, 0.8, 0]}>
            <torusGeometry args={[0.6, 0.025, 8, 24]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>
        </group>
      )}

      {/* --- WAITING APPROVAL: DANGER BEACON --- */}
      {status === "waiting_approval" && (
        <group ref={alertMarkerRef} position={[0, targetHeight + 0.35, 0]}>
          <mesh>
            <octahedronGeometry args={[0.26, 0]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <pointLight color="#ef4444" intensity={3.5} distance={5} />
        </group>
      )}

      {/* --- DIALOGUE / TASK SPEECH BUBBLE (Above Head only when speaking/active) --- */}
      {(currentTask || status === "waiting_approval") && (
        <Billboard
          position={[0, targetHeight + 0.38, 0]}
          follow={true}
          lockX={false}
          lockY={false}
          lockZ={false}
        >
          <group position={[0, 0, 0]}>
            <mesh position={[0, 0, -0.015]}>
              <planeGeometry args={[Math.min(3.2, Math.max(1.8, (currentTask?.length || 20) * 0.09)), 0.34]} />
              <meshBasicMaterial
                color={status === "waiting_approval" ? "#7f1d1d" : "#0f172a"}
                transparent
                opacity={0.92}
                depthWrite={false}
              />
            </mesh>
            <mesh position={[0, 0, -0.02]}>
              <planeGeometry args={[Math.min(3.2, Math.max(1.8, (currentTask?.length || 20) * 0.09)) + 0.05, 0.39]} />
              <meshBasicMaterial
                color={status === "waiting_approval" ? "#ef4444" : "#38bdf8"}
                transparent
                opacity={0.8}
                depthWrite={false}
              />
            </mesh>
            <Text
              position={[0, 0, 0.01]}
              fontSize={0.13}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              maxWidth={3.0}
            >
              {status === "waiting_approval"
                ? "⚠️ Cần thuyền trưởng phê duyệt!"
                : currentTask || ""}
            </Text>
          </group>
        </Billboard>
      )}

      {/* --- SLEEK GROUND-LEVEL CAPSULE PILL BADGE (Matching Image 2) --- */}
      {/* Placed at waist/ground height [0, 0.36, 0.32] to never block character face/head */}
      <Billboard
        position={[0, 0.36, 0.38]}
        follow={true}
        lockX={false}
        lockY={false}
        lockZ={false}
      >
        <group
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          {/* Translucent Dark Pill Plate */}
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[2.0, 0.34]} />
            <meshBasicMaterial
              color={isSelected ? "#78350f" : "#090d16"}
              transparent
              opacity={0.88}
              depthWrite={false}
            />
          </mesh>

          {/* Border Outline colored by character aura */}
          <mesh position={[0, 0, -0.015]}>
            <planeGeometry args={[2.05, 0.39]} />
            <meshBasicMaterial
              color={isSelected ? "#fbbf24" : color || statusColor}
              transparent
              opacity={0.8}
              depthWrite={false}
            />
          </mesh>

          {/* Glowing Status Dot */}
          <mesh position={[-0.82, 0.0, 0.01]}>
            <circleGeometry args={[0.065, 16]} />
            <meshBasicMaterial color={statusColor} />
          </mesh>

          {/* Name & Status in Single Line (e.g. "Victoria Vance | IDLE") */}
          <Text
            position={[-0.05, 0.0, 0.01]}
            fontSize={0.125}
            color="#f8fafc"
            anchorX="center"
            anchorY="middle"
            maxWidth={1.65}
          >
            {`${displayName.split("(")[0].trim()}  [${statusLabel}]`}
          </Text>
        </group>
      </Billboard>
    </group>
  );
}
