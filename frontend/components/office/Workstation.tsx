"use client";

import React, { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { CanonicalAgentState, CANONICAL_STATE_CONFIGS } from "@/types/office";

export interface WorkstationData {
  workstation_id: string;
  zone: string;
  label: string;
  department: string;
  desk_number: number | null;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  occupancy_status: "vacant" | "reserved" | "occupied" | "maintenance" | string;
  assigned_employee?: string | null;
  assigned_employee_name?: string | null;
  assigned_employee_role?: string | null;
  occupant_state?: CanonicalAgentState;
  is_virtual?: boolean;
}

interface WorkstationProps {
  data: WorkstationData;
  rotation?: [number, number, number];
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}

export default function Workstation({
  data,
  rotation = [0, 0, 0],
  isSelected = false,
  onSelect,
}: WorkstationProps) {
  const [isHovered, setIsHovered] = useState(false);

  const occupantState = data.occupant_state || "IDLE";
  const stateConfig = CANONICAL_STATE_CONFIGS[occupantState] || CANONICAL_STATE_CONFIGS.IDLE;

  const isOccupied = data.occupancy_status === "occupied" || !!data.assigned_employee;
  const screenColor = isOccupied ? stateConfig.monitorColor : "#1e293b";
  const emissiveIntensity = isOccupied ? (isHovered ? 0.9 : 0.6) : 0.1;

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect(data.workstation_id);
    }
  };

  return (
    <group
      position={[data.pos_x, 0, data.pos_z]}
      rotation={rotation}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
      }}
      onPointerOut={() => setIsHovered(false)}
    >
      {/* 1. Selection & Hover Floor Halo */}
      {(isSelected || isHovered) && (
        <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.7, 2.2]} />
          <meshBasicMaterial
            color={isSelected ? "#38bdf8" : "#94a3b8"}
            transparent
            opacity={isSelected ? 0.35 : 0.18}
          />
        </mesh>
      )}

      {/* 2. Desk Top (Natural White Oak / Ash Finish) */}
      <mesh castShadow receiveShadow position={[0, 0.73, 0]}>
        <boxGeometry args={[2.2, 0.05, 1.0]} />
        <meshStandardMaterial
          color={isSelected ? "#e2e8f0" : "#d4a373"}
          roughness={0.4}
          metalness={0.05}
        />
      </mesh>

      {/* 3. Matte Black Steel Desk Frame & Legs */}
      {[-0.98, 0.98].map((x, idx) => (
        <group key={idx} position={[x, 0.36, 0]}>
          <mesh castShadow position={[0, 0, 0]}>
            <boxGeometry args={[0.06, 0.72, 0.88]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.2} />
          </mesh>
          <mesh position={[0, -0.35, 0]}>
            <boxGeometry args={[0.1, 0.03, 0.94]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* 4. Dual Display Monitor Rig */}
      <group position={[0, 0.76, -0.25]}>
        {/* Monitor Pole Base */}
        <mesh position={[0, 0.16, -0.1]}>
          <cylinderGeometry args={[0.02, 0.025, 0.35, 12]} />
          <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.15} />
        </mesh>

        {/* Center Primary Curved Ultrawide Display */}
        <group position={[0, 0.32, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.05, 0.46, 0.03]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Glowing Screen Face */}
          <mesh position={[0, 0, 0.018]}>
            <planeGeometry args={[1.01, 0.42]} />
            <meshStandardMaterial
              color="#090d16"
              emissive={screenColor}
              emissiveIntensity={emissiveIntensity}
              roughness={0.2}
            />
          </mesh>
        </group>

        {/* Left Secondary Portrait Screen */}
        <group position={[-0.68, 0.32, 0.06]} rotation={[0, 0.32, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.34, 0.46, 0.03]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0, 0.018]}>
            <planeGeometry args={[0.31, 0.42]} />
            <meshStandardMaterial
              color="#090d16"
              emissive={screenColor}
              emissiveIntensity={emissiveIntensity * 0.8}
              roughness={0.2}
            />
          </mesh>
        </group>
      </group>

      {/* 5. Minimalist Ergonomic Task Chair */}
      <group position={[0, 0, 0.55]} rotation={[0, Math.PI, 0]}>
        {/* Chair 5-Star Caster Base */}
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.04, 5]} />
          <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.35, 12]} />
          <meshStandardMaterial color="#334155" metalness={0.8} />
        </mesh>
        {/* Chair Seat Cushion */}
        <mesh castShadow position={[0, 0.44, 0]}>
          <boxGeometry args={[0.5, 0.08, 0.48]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>
        {/* Ergonomic Mesh Backrest */}
        <mesh castShadow position={[0, 0.72, -0.22]} rotation={[0.08, 0, 0]}>
          <boxGeometry args={[0.46, 0.52, 0.05]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} />
        </mesh>
      </group>

      {/* 6. Desk Lamp with Ambient Task Light */}
      <group position={[0.82, 0.76, -0.2]}>
        <mesh position={[0, 0.01, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.02, 16]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.36, 8]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>
        {/* Lamp Shade */}
        <mesh position={[0, 0.36, 0.06]} rotation={[0.4, 0, 0]}>
          <coneGeometry args={[0.07, 0.08, 16]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        {isOccupied && (
          <pointLight
            position={[0, 0.32, 0.06]}
            intensity={0.4}
            distance={2.5}
            decay={2}
            color="#fed7aa"
          />
        )}
      </group>

      {/* 7. Floating Workstation Label / Status Badge (when hovered or selected) */}
      {(isHovered || isSelected) && (
        <Html position={[0, 1.45, 0]} center distanceFactor={14}>
          <div className="pointer-events-none px-2 py-1 rounded-md bg-slate-900/90 border border-slate-700/80 shadow-lg backdrop-blur-sm text-xs text-slate-200 whitespace-nowrap flex flex-col items-center">
            <span className="font-semibold text-sky-400">
              {data.label || data.workstation_id}
            </span>
            <span className="text-[10px] text-slate-400">
              {data.assigned_employee_name
                ? `${data.assigned_employee_name} • ${stateConfig.label}`
                : "Chỗ trống (Vacant)"}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

