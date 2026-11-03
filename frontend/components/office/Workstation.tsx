"use client";

import React, { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { Terminal } from "lucide-react";
import { CanonicalAgentState, CANONICAL_STATE_CONFIGS } from "@/types/office";
import { useWorkstationStore } from "@/store/workstationStore";

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

// Shared Workstation Geometries (Singletons reused across all desks)
const DESK_TOP_GEOMETRY = new THREE.BoxGeometry(2.2, 0.05, 1.0);
const DESK_FRAME_LEG_GEOMETRY = new THREE.BoxGeometry(0.06, 0.72, 0.88);
const DESK_FRAME_FOOT_GEOMETRY = new THREE.BoxGeometry(0.1, 0.03, 0.94);
const MONITOR_POLE_GEOMETRY = new THREE.CylinderGeometry(0.02, 0.025, 0.35, 8);
const MONITOR_WIDE_BODY_GEOMETRY = new THREE.BoxGeometry(1.05, 0.46, 0.03);
const SCREEN_WIDE_FACE_GEOMETRY = new THREE.PlaneGeometry(1.01, 0.42);
const MONITOR_PORT_BODY_GEOMETRY = new THREE.BoxGeometry(0.34, 0.46, 0.03);
const SCREEN_PORT_FACE_GEOMETRY = new THREE.PlaneGeometry(0.31, 0.42);
const CHAIR_CASTER_GEOMETRY = new THREE.CylinderGeometry(0.28, 0.28, 0.04, 5);
const CHAIR_POLE_GEOMETRY = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8);
const CHAIR_CUSHION_GEOMETRY = new THREE.BoxGeometry(0.5, 0.08, 0.48);
const CHAIR_BACKREST_GEOMETRY = new THREE.BoxGeometry(0.46, 0.52, 0.05);
const LAMP_BASE_GEOMETRY = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10);
const LAMP_POLE_GEOMETRY = new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6);
const LAMP_SHADE_GEOMETRY = new THREE.ConeGeometry(0.07, 0.08, 10);
const HALO_GEOMETRY = new THREE.PlaneGeometry(2.7, 2.2);

// Shared Workstation Materials (Singletons reused across all desks)
const DESK_WOOD_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#d4a373",
  roughness: 0.4,
  metalness: 0.05,
});
const DESK_SELECTED_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#e2e8f0",
  roughness: 0.4,
  metalness: 0.05,
});
const STEEL_FRAME_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#0f172a",
  metalness: 0.85,
  roughness: 0.2,
});
const CHAIR_POLE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#334155",
  metalness: 0.8,
});
const CHAIR_CUSHION_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#1e293b",
  roughness: 0.7,
});
const CHAIR_BACKREST_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#0f172a",
  roughness: 0.6,
});
const HALO_SELECTED_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#38bdf8",
  transparent: true,
  opacity: 0.35,
});
const HALO_HOVER_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#94a3b8",
  transparent: true,
  opacity: 0.18,
});

// Cache for screen materials
const SCREEN_MATERIALS = new Map<string, THREE.MeshStandardMaterial>();
function getScreenMaterial(color: string, intensity: number): THREE.MeshStandardMaterial {
  const key = `${color}_${intensity.toFixed(2)}`;
  let mat = SCREEN_MATERIALS.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: "#090d16",
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.2,
    });
    SCREEN_MATERIALS.set(key, mat);
  }
  return mat;
}

function Workstation({
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
        <mesh
          position={[0, 0.008, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={HALO_GEOMETRY}
          material={isSelected ? HALO_SELECTED_MATERIAL : HALO_HOVER_MATERIAL}
        />
      )}

      {/* 2. Desk Top (Natural White Oak / Ash Finish - Primary Shadow Caster) */}
      <mesh
        castShadow
        receiveShadow
        position={[0, 0.73, 0]}
        geometry={DESK_TOP_GEOMETRY}
        material={isSelected ? DESK_SELECTED_MATERIAL : DESK_WOOD_MATERIAL}
      />

      {/* 3. Matte Black Steel Desk Frame & Legs */}
      {[-0.98, 0.98].map((x, idx) => (
        <group key={idx} position={[x, 0.36, 0]}>
          <mesh
            position={[0, 0, 0]}
            geometry={DESK_FRAME_LEG_GEOMETRY}
            material={STEEL_FRAME_MATERIAL}
          />
          <mesh
            position={[0, -0.35, 0]}
            geometry={DESK_FRAME_FOOT_GEOMETRY}
            material={STEEL_FRAME_MATERIAL}
          />
        </group>
      ))}

      {/* 4. Dual Display Monitor Rig */}
      <group position={[0, 0.76, -0.25]}>
        {/* Monitor Pole Base */}
        <mesh
          position={[0, 0.16, -0.1]}
          geometry={MONITOR_POLE_GEOMETRY}
          material={STEEL_FRAME_MATERIAL}
        />

        {/* Center Primary Curved Ultrawide Display */}
        <group position={[0, 0.32, 0]}>
          <mesh
            geometry={MONITOR_WIDE_BODY_GEOMETRY}
            material={STEEL_FRAME_MATERIAL}
          />
          {/* Glowing Screen Face */}
          <mesh
            position={[0, 0, 0.018]}
            geometry={SCREEN_WIDE_FACE_GEOMETRY}
            material={getScreenMaterial(screenColor, emissiveIntensity)}
          />
        </group>

        {/* Left Secondary Portrait Screen */}
        <group position={[-0.68, 0.32, 0.06]} rotation={[0, 0.32, 0]}>
          <mesh
            geometry={MONITOR_PORT_BODY_GEOMETRY}
            material={STEEL_FRAME_MATERIAL}
          />
          <mesh
            position={[0, 0, 0.018]}
            geometry={SCREEN_PORT_FACE_GEOMETRY}
            material={getScreenMaterial(screenColor, emissiveIntensity * 0.8)}
          />
        </group>
      </group>

      {/* 5. Minimalist Ergonomic Task Chair */}
      <group position={[0, 0, 0.55]} rotation={[0, Math.PI, 0]}>
        {/* Chair 5-Star Caster Base */}
        <mesh
          position={[0, 0.06, 0]}
          geometry={CHAIR_CASTER_GEOMETRY}
          material={STEEL_FRAME_MATERIAL}
        />
        <mesh
          position={[0, 0.24, 0]}
          geometry={CHAIR_POLE_GEOMETRY}
          material={CHAIR_POLE_MATERIAL}
        />
        {/* Chair Seat Cushion */}
        <mesh
          position={[0, 0.44, 0]}
          geometry={CHAIR_CUSHION_GEOMETRY}
          material={CHAIR_CUSHION_MATERIAL}
        />
        {/* Ergonomic Mesh Backrest */}
        <mesh
          position={[0, 0.72, -0.22]}
          rotation={[0.08, 0, 0]}
          geometry={CHAIR_BACKREST_GEOMETRY}
          material={CHAIR_BACKREST_MATERIAL}
        />
      </group>

      {/* 6. Desk Lamp with Ambient Task Light */}
      <group position={[0.82, 0.76, -0.2]}>
        <mesh
          position={[0, 0.01, 0]}
          geometry={LAMP_BASE_GEOMETRY}
          material={STEEL_FRAME_MATERIAL}
        />
        <mesh
          position={[0, 0.18, 0]}
          geometry={LAMP_POLE_GEOMETRY}
          material={STEEL_FRAME_MATERIAL}
        />
        {/* Lamp Shade */}
        <mesh
          position={[0, 0.36, 0.06]}
          rotation={[0.4, 0, 0]}
          geometry={LAMP_SHADE_GEOMETRY}
          material={STEEL_FRAME_MATERIAL}
        />
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
        <Html position={[0, 1.55, 0]} center distanceFactor={14}>
          <div
            tabIndex={0}
            role="button"
            aria-label={`Bàn làm việc ${data.label || data.workstation_id}: ${data.assigned_employee_name || "Trống"}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick(e);
              }
            }}
            className={`px-2.5 py-1.5 rounded-lg border shadow-xl backdrop-blur-md text-xs transition-all pointer-events-auto cursor-pointer flex items-center gap-2 ${
              isSelected
                ? "bg-slate-900/95 border-sky-400 text-sky-200 ring-2 ring-sky-500/40"
                : "bg-slate-900/90 border-slate-700/80 text-slate-200 hover:border-slate-500"
            }`}
          >
            {isOccupied && data.assigned_employee_name ? (
              <>
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 text-white"
                  style={{ backgroundColor: stateConfig.beaconColor }}
                >
                  {data.assigned_employee_name.charAt(0)}
                </div>
                <div className="flex flex-col text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-100 text-[11px] leading-tight">
                      {data.assigned_employee_name}
                    </span>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
                      style={{ backgroundColor: stateConfig.beaconColor }}
                    />
                  </div>
                  <span className="text-[9px] text-slate-400 leading-tight">
                    {data.label || data.workstation_id} • {stateConfig.label}
                  </span>
                </div>
                {/* Direct Live Terminal button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    useWorkstationStore.getState().openWorkstationScreen(data.assigned_employee || data.workstation_id);
                  }}
                  className="ml-1 p-1 rounded bg-slate-800 hover:bg-emerald-950 text-slate-300 hover:text-emerald-300 border border-slate-700 hover:border-emerald-700 transition-colors cursor-pointer"
                  title="Mở màn hình làm việc (Live Terminal)"
                >
                  <Terminal className="w-3 h-3" />
                </button>
              </>
            ) : (
              <div className="flex flex-col text-center">
                <span className="font-semibold text-slate-300 text-[11px] leading-tight">
                  {data.label || data.workstation_id}
                </span>
                <span className="text-[9px] text-slate-500 leading-tight">
                  Bàn làm việc trống (Vacant)
                </span>
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

export default React.memo(Workstation, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.data.workstation_id === next.data.workstation_id &&
    prev.data.occupancy_status === next.data.occupancy_status &&
    prev.data.assigned_employee === next.data.assigned_employee &&
    prev.data.occupant_state === next.data.occupant_state &&
    prev.data.pos_x === next.data.pos_x &&
    prev.data.pos_z === next.data.pos_z &&
    prev.rotation?.[0] === next.rotation?.[0] &&
    prev.rotation?.[1] === next.rotation?.[1] &&
    prev.rotation?.[2] === next.rotation?.[2]
  );
});

