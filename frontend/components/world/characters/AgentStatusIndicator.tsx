"use client";

import React, { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import { WorldAgentStatus } from "@/types";

interface AgentStatusIndicatorProps {
  status: WorldAgentStatus;
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
      if (status === "working") {
        baseRingRef.current.rotation.z = t * 3.5;
        baseRingRef.current.scale.setScalar(1 + Math.sin(t * 8) * 0.12);
      } else if (status === "waiting_approval") {
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
    switch (status) {
      case "working":
        return "WORKING";
      case "waiting_approval":
        return "AWAITING APPROVAL";
      case "error":
        return "ERROR";
      case "offline":
        return "OFFLINE";
      default:
        return "READY";
    }
  };

  const statusColor = getStatusColor();
  const firstName = name.split(" ")[0];

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

      {/* --- WAITING APPROVAL: DANGER BEACON & 3D OCTAHEDRON --- */}
      {status === "waiting_approval" && (
        <group ref={alertMarkerRef} position={[0, 2.65, 0]}>
          <mesh>
            <octahedronGeometry args={[0.32, 0]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <pointLight color="#ef4444" intensity={3.5} distance={5} />
        </group>
      )}

      {/* --- 3D BILLBOARD HUD: ZERO DOM UNMOUNT ISSUES & 60FPS SMOOTH --- */}
      <Billboard
        position={[0, targetHeight + 0.45, 0]}
        follow={true}
        lockX={false}
        lockY={false}
        lockZ={false}
      >
        {/* Task / Status Speech Bubble Banner */}
        {(status !== "idle" || currentTask) && (
          <group position={[0, 0.65, 0]}>
            <mesh position={[0, 0, -0.02]}>
              <planeGeometry args={[2.8, 0.38]} />
              <meshBasicMaterial
                color={
                  status === "waiting_approval"
                    ? "#450a0a"
                    : status === "working"
                    ? "#451a03"
                    : "#0f172a"
                }
                transparent
                opacity={0.88}
              />
            </mesh>
            <mesh position={[0, 0, -0.025]}>
              <planeGeometry args={[2.86, 0.44]} />
              <meshBasicMaterial
                color={
                  status === "waiting_approval"
                    ? "#ef4444"
                    : status === "working"
                    ? "#f59e0b"
                    : "#38bdf8"
                }
                transparent
                opacity={0.7}
              />
            </mesh>
            <Text
              position={[0, 0, 0.01]}
              fontSize={0.14}
              color={status === "waiting_approval" ? "#fca5a5" : "#fef08a"}
              anchorX="center"
              anchorY="middle"
              maxWidth={2.6}
            >
              {status === "waiting_approval"
                ? "⚠️ Captain's Authorization Needed"
                : currentTask || "Processing mission..."}
            </Text>
          </group>
        )}

        {/* Character Nameplate Pill */}
        <group
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          {/* Background Pill Plate */}
          <mesh position={[0, 0, -0.015]}>
            <planeGeometry args={[1.9, 0.48]} />
            <meshBasicMaterial
              color={isSelected ? "#78350f" : "#090d16"}
              transparent
              opacity={0.9}
              depthWrite={false}
            />
          </mesh>
          {/* Border Outline */}
          <mesh position={[0, 0, -0.025]}>
            <planeGeometry args={[1.96, 0.54]} />
            <meshBasicMaterial
              color={isSelected ? "#fbbf24" : statusColor}
              transparent
              opacity={0.85}
              depthWrite={false}
            />
          </mesh>

          {/* Status Glow Dot */}
          <mesh position={[-0.72, 0.04, 0.01]}>
            <circleGeometry args={[0.08, 16]} />
            <meshBasicMaterial color={statusColor} />
          </mesh>

          {/* Character Name */}
          <Text
            position={[-0.08, 0.07, 0.01]}
            fontSize={0.21}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
          >
            {firstName}
          </Text>

          {/* Status Subtitle */}
          <Text
            position={[0, -0.13, 0.01]}
            fontSize={0.11}
            color={statusColor}
            anchorX="center"
            anchorY="middle"
          >
            {`[${getStatusLabel()}]`}
          </Text>
        </group>
      </Billboard>
    </group>
  );
}
